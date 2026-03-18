const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { CONFIG } = require('../config');
const { uid, nowIso } = require('../utils/ids');
const logger = require('../utils/logger');
const { emitEvent } = require('./events');
const {
  upsertJob,
  getModelById,
  getLoraById,
  getSettings,
} = require('./state');
const { startRuntime, stopRuntime } = require('./runtime');
const providers = require('./providers');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function appendLog(logFile, line) {
  const text = `[${new Date().toISOString()}] ${line}\n`;
  await fsp.mkdir(path.dirname(logFile), { recursive: true });
  await fsp.appendFile(logFile, text, 'utf8');
}

function ensureArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty array`);
  }
}

function safePromptPreview(prompt, maxLen = 120) {
  const text = String(prompt || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

async function resolveComparisonTarget(target) {
  if (!target || typeof target !== 'object') {
    throw new Error('Each target must be an object');
  }

  const type = String(target.type || '').trim();

  if (type === 'model') {
    const model = await getModelById(target.id);
    if (!model) {
      throw new Error(`Model not found: ${target.id}`);
    }
    if (model.status !== 'ready') {
      throw new Error(`Model is not ready: ${model.name}`);
    }

    return {
      id: model.id,
      type: 'model',
      label: model.name,
      runtimeConfig: {
        model: model.path,
        baseModel: model.name,
        activeModelId: model.id,
        activeModelName: model.name,
        activeLoraId: null,
        activeLoraName: null,
      },
      meta: {
        modelId: model.id,
        modelPath: model.path,
        quantization: model.quantization || 'none',
        source: 'model',
      },
    };
  }

  if (type === 'lora') {
    const lora = await getLoraById(target.id);
    if (!lora) {
      throw new Error(`LoRA not found: ${target.id}`);
    }
    if (lora.status !== 'ready') {
      throw new Error(`LoRA is not ready: ${lora.name}`);
    }

    let baseModelPath = lora.baseModelRef;
    let baseModelName = lora.baseModelName;

    if (lora.baseModelId) {
      const baseModel = await getModelById(lora.baseModelId);
      if (baseModel?.path) {
        baseModelPath = baseModel.path;
        baseModelName = baseModel.name;
      }
    }

    if (!baseModelPath) {
      throw new Error(`Unable to resolve base model for LoRA: ${lora.name}`);
    }

    return {
      id: lora.id,
      type: 'lora',
      label: lora.name,
      runtimeConfig: {
        model: baseModelPath,
        baseModel: baseModelName || baseModelPath,
        activeModelId: lora.baseModelId || null,
        activeModelName: baseModelName || null,
        activeLoraId: lora.id,
        activeLoraName: lora.name,
        loraPath: lora.adapterPath,
        loraName: lora.name,
      },
      meta: {
        loraId: lora.id,
        loraPath: lora.adapterPath,
        baseModelId: lora.baseModelId || null,
        baseModelPath,
        source: 'lora',
      },
    };
  }

  throw new Error(`Unsupported target type: ${type}`);
}

async function parseResponseSafely(response) {
  const text = await response.text();
  try {
    return {
      rawText: text,
      json: JSON.parse(text),
    };
  } catch {
    return {
      rawText: text,
      json: null,
    };
  }
}

async function runSinglePrompt({ provider, runtimeState, prompt, options, logFile }) {
  const startedAt = nowIso();
  const started = Date.now();

  const effectiveModel =
    runtimeState.activeLoraName ||
    runtimeState.activeModelName ||
    runtimeState.model;

  try {
    await appendLog(logFile, `Prompt started: "${safePromptPreview(prompt)}"`);

    const response = await provider.chat(runtimeState, {
      model: effectiveModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: Number(options.max_tokens ?? 256),
      temperature: Number(options.temperature ?? 0),
      stream: false,
    });

    const durationSec = (Date.now() - started) / 1000;
    const parsed = await parseResponseSafely(response);

    if (!response.ok) {
      await appendLog(
        logFile,
        `Prompt failed with HTTP ${response.status}: "${safePromptPreview(prompt)}"`
      );

      return {
        prompt,
        startedAt,
        durationSec,
        ok: false,
        error: `HTTP ${response.status}`,
        raw: parsed.json || parsed.rawText,
      };
    }

    const choice = parsed.json?.choices?.[0];
    const content = choice?.message?.content;

    if (typeof content !== 'string') {
      await appendLog(
        logFile,
        `Prompt failed: response has no choices[0].message.content`
      );

      return {
        prompt,
        startedAt,
        durationSec,
        ok: false,
        error: `Response does not contain choices[0].message.content`,
        raw: parsed.json || parsed.rawText,
      };
    }

    await appendLog(
      logFile,
      `Prompt completed in ${durationSec.toFixed(3)}s: "${safePromptPreview(prompt)}"`
    );

    return {
      prompt,
      startedAt,
      durationSec,
      ok: true,
      response: {
        content,
        finish_reason: choice?.finish_reason || null,
        usage: parsed.json?.usage || null,
      },
      raw: parsed.json || parsed.rawText,
    };
  } catch (err) {
    const durationSec = (Date.now() - started) / 1000;
    await appendLog(
      logFile,
      `Prompt exception in ${durationSec.toFixed(3)}s: ${String(err.message || err)}`
    );

    return {
      prompt,
      startedAt,
      durationSec,
      ok: false,
      error: String(err.message || err),
    };
  }
}

function buildSummary(allResults) {
  const targetSummaries = allResults.map((entry) => {
    const total = entry.results.length;
    const okCount = entry.results.filter((x) => x.ok).length;
    const failedCount = total - okCount;

    const durations = entry.results
      .map((x) => Number(x.durationSec))
      .filter((x) => Number.isFinite(x));

    const completionTokens = entry.results
      .map((x) => Number(x.response?.usage?.completion_tokens))
      .filter((x) => Number.isFinite(x));

    return {
      target: entry.target,
      provider: entry.runtime.provider,
      totalPrompts: total,
      okCount,
      failedCount,
      avgDurationSec: durations.length
        ? Number((durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(3))
        : null,
      avgCompletionTokens: completionTokens.length
        ? Number(
            (
              completionTokens.reduce((a, b) => a + b, 0) / completionTokens.length
            ).toFixed(3)
          )
        : null,
    };
  });

  return {
    targets: targetSummaries.length,
    promptsPerTarget: allResults[0]?.results?.length || 0,
    targetSummaries,
  };
}

async function saveComparisonArtifacts(outputDir, payload) {
  await fsp.mkdir(outputDir, { recursive: true });

  const resultFile = path.join(outputDir, 'comparison-result.json');
  const summaryFile = path.join(outputDir, 'summary.json');

  await fsp.writeFile(resultFile, JSON.stringify(payload.results, null, 2), 'utf8');
  await fsp.writeFile(summaryFile, JSON.stringify(payload.summary, null, 2), 'utf8');

  return {
    resultFile,
    summaryFile,
  };
}

async function executeComparisonJob(job, resolvedTargets, prompts, inferenceOptions) {
  await appendLog(job.logFile, `Comparison job started: ${job.id}`);
  await appendLog(job.logFile, `Targets: ${resolvedTargets.length}, prompts: ${prompts.length}`);

  const allResults = [];

  try {
    for (let index = 0; index < resolvedTargets.length; index += 1) {
      const target = resolvedTargets[index];

      await appendLog(
        job.logFile,
        `Preparing target ${index + 1}/${resolvedTargets.length}: ${target.label} (${target.type})`
      );

      await stopRuntime().catch(() => {});
      await sleep(1000);

      const runtimeState = await startRuntime({
        ...target.runtimeConfig,
        provider: inferenceOptions.provider,
        port: Number(inferenceOptions.port || CONFIG.vllmPort),
        maxModelLen: inferenceOptions.maxModelLen,
        gpuMemoryUtilization: inferenceOptions.gpuMemoryUtilization,
        tensorParallelSize: inferenceOptions.tensorParallelSize,
        quantization: inferenceOptions.quantization,
        dtype: inferenceOptions.dtype,
        trustRemoteCode: inferenceOptions.trustRemoteCode,
        enforceEager: inferenceOptions.enforceEager,
        kvCacheDtype: inferenceOptions.kvCacheDtype,
        maxNumSeqs: inferenceOptions.maxNumSeqs,
        swapSpace: inferenceOptions.swapSpace,
      });

      const providerId = runtimeState.providerResolved || 'vllm';
      const provider = providers.PROVIDERS[providerId];

      if (!provider) {
        throw new Error(`Resolved provider not found: ${providerId}`);
      }

      await appendLog(
        job.logFile,
        `Target runtime started with provider=${providerId}, model=${runtimeState.model}, lora=${runtimeState.activeLoraName || '-'}`
      );

      const promptResults = [];
      for (const prompt of prompts) {
        const row = await runSinglePrompt({
          provider,
          runtimeState,
          prompt,
          options: inferenceOptions,
          logFile: job.logFile,
        });
        promptResults.push(row);
      }

      allResults.push({
        target: {
          id: target.id,
          type: target.type,
          label: target.label,
          meta: target.meta,
        },
        runtime: {
          provider: providerId,
          model: runtimeState.model,
          activeModelName: runtimeState.activeModelName || null,
          activeLoraName: runtimeState.activeLoraName || null,
          port: runtimeState.port,
        },
        results: promptResults,
      });

      const summary = buildSummary(allResults);
      await saveComparisonArtifacts(job.outputDir, {
        results: allResults,
        summary,
      });

      const updated = await upsertJob({
        ...job,
        summaryMetrics: summary,
      });
      emitEvent('job_updated', updated);
    }

    await stopRuntime().catch(() => {});
    const summary = buildSummary(allResults);
    await saveComparisonArtifacts(job.outputDir, {
      results: allResults,
      summary,
    });

    const completedJob = await upsertJob({
      ...job,
      status: 'completed',
      finishedAt: nowIso(),
      pid: null,
      summaryMetrics: summary,
      artifacts: [
        {
          name: 'comparison-result.json',
          path: path.join(job.outputDir, 'comparison-result.json'),
        },
        {
          name: 'summary.json',
          path: path.join(job.outputDir, 'summary.json'),
        },
      ],
      error: null,
    });

    emitEvent('job_updated', completedJob);
    await appendLog(job.logFile, `Comparison job completed: ${job.id}`);
    logger.info('Comparison job completed', { jobId: job.id });

    return completedJob;
  } catch (err) {
    await stopRuntime().catch(() => {});
    await appendLog(job.logFile, `Comparison job failed: ${String(err.message || err)}`);

    const failedJob = await upsertJob({
      ...job,
      status: 'failed',
      finishedAt: nowIso(),
      pid: null,
      error: String(err.message || err),
    });

    emitEvent('job_updated', failedJob);
    logger.error('Comparison job failed', {
      jobId: job.id,
      error: String(err.message || err),
    });

    throw err;
  }
}

async function startComparisonJob({ name, targets, prompts, inference = {} }) {
  ensureArray(targets, 'targets');
  ensureArray(prompts, 'prompts');

  const cleanedPrompts = prompts
    .map((x) => String(x || '').trim())
    .filter(Boolean);

  ensureArray(cleanedPrompts, 'prompts');

  const settings = await getSettings();
  const resolvedTargets = [];

  for (const target of targets) {
    resolvedTargets.push(await resolveComparisonTarget(target));
  }

  const jobId = uid('job');
  const outputDir = path.join(CONFIG.trainingOutputsDir, jobId);
  const logFile = path.join(CONFIG.logsDir, `${jobId}.log`);

  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.mkdir(CONFIG.logsDir, { recursive: true });

  const job = {
    id: jobId,
    type: 'model-comparison',
    name: String(name || `comparison-${jobId}`).trim(),
    status: 'running',
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: null,
    outputDir,
    logFile,
    pid: process.pid,
    error: null,
    tags: [],
    notes: '',
    artifacts: [],
    summaryMetrics: {},
    paramsSnapshot: {
      targets,
      prompts: cleanedPrompts,
      inference,
    },
  };

  await upsertJob(job);
  emitEvent('job_updated', job);

  const inferenceOptions = {
    provider: inference.provider ?? settings.inference?.provider ?? 'auto',
    port: Number(inference.port ?? settings.inference?.port ?? CONFIG.vllmPort),
    max_tokens: Number(inference.max_tokens ?? 256),
    temperature: Number(inference.temperature ?? 0),
    maxModelLen: inference.maxModelLen ?? settings.inference?.maxModelLen,
    gpuMemoryUtilization:
      inference.gpuMemoryUtilization ?? settings.inference?.gpuMemoryUtilization,
    tensorParallelSize:
      inference.tensorParallelSize ?? settings.inference?.tensorParallelSize,
    quantization: inference.quantization ?? settings.inference?.quantization,
    dtype: inference.dtype ?? settings.inference?.dtype,
    trustRemoteCode: inference.trustRemoteCode ?? settings.inference?.trustRemoteCode,
    enforceEager: inference.enforceEager ?? settings.inference?.enforceEager,
    kvCacheDtype: inference.kvCacheDtype ?? settings.inference?.kvCacheDtype,
    maxNumSeqs: inference.maxNumSeqs ?? settings.inference?.maxNumSeqs,
    swapSpace: inference.swapSpace ?? settings.inference?.swapSpace,
  };

  // Запуск асинхронно, чтобы HTTP-ответ вернулся сразу.
  setImmediate(() => {
    executeComparisonJob(job, resolvedTargets, cleanedPrompts, inferenceOptions).catch(
      () => {}
    );
  });

  return {
    ok: true,
    jobId,
    outputDir,
    logFile,
  };
}

module.exports = {
  startComparisonJob,
};