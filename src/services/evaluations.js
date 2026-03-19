const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config');
const { nowIso, uid } = require('../utils/ids');
const {
  getEvalDatasets,
  addEvalDataset,
  upsertJob,
  getSettings,
} = require('./state');
const { emitEvent } = require('./events');
const logger = require('../utils/logger');
const { startRuntime, stopRuntime } = require('./runtime');
const providers = require('./providers');

function parseHashTagsLine(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`));
}

function normalizeImportedScore(value, scale) {
  const score = Number.parseFloat(value);
  if (!Number.isFinite(score)) return null;

  const denom = Number(scale);
  if (denom === 10) {
    return score / 2;
  }

  if (denom === 5) {
    return score;
  }

  return null;
}

function parseEvalTxt(content, sourceName = 'unknown') {
  const samples = [];
  const errors = [];

  const text = String(content || '').replace(/\r\n/g, '\n');
  const blocks = text.split(/\n\s*\n+/).map((x) => x.trim()).filter(Boolean);

  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];

    const qMatch = block.match(/question:\s*([\s\S]*?)(?=\nanswer:|\nscore:|\nhashTags:|$)/i);
    const aMatch = block.match(/answer:\s*([\s\S]*?)(?=\nscore:|\nhashTags:|$)/i);
    const sMatch = block.match(/score:\s*(\d+(?:\.\d+)?)\s*\/\s*(5|10)/i);
    const hMatch = block.match(/hashTags:\s*([\s\S]*?)$/i);

    if (!qMatch || !aMatch || !sMatch) {
      const missing = [];
      if (!qMatch) missing.push('question');
      if (!aMatch) missing.push('answer');
      if (!sMatch) missing.push('score');

      errors.push({
        index: i,
        error: `Отсутствуют поля: ${missing.join(', ')}`,
        raw: block.slice(0, 400),
      });
      continue;
    }

    const normalizedScore = normalizeImportedScore(sMatch[1], sMatch[2]);
    if (!Number.isFinite(normalizedScore) || normalizedScore < 0 || normalizedScore > 5) {
      errors.push({
        index: i,
        error: 'score должен быть числом от 0 до 5 (или от 0 до 10 для старого формата)',
        raw: block.slice(0, 400),
      });
      continue;
    }

    const hashTags = parseHashTagsLine(hMatch?.[1] || '');

    samples.push({
      id: uid('sample'),
      question: qMatch[1].trim(),
      candidateAnswer: aMatch[1].trim(),
      referenceScore: normalizedScore,
      maxScore: 5,
      hashTags,
      sourceFile: sourceName,
      topic: null,
    });
  }

  return { samples, errors };
}

function buildEvalPrompt(sample) {
  const tagsText = Array.isArray(sample.hashTags) && sample.hashTags.length
    ? sample.hashTags.join(', ')
    : 'none';

  return `Ты — беспристрастный эксперт-оценщик. Тебе предоставлен вопрос и ответ кандидата.
Твоя задача — выставить оценку от 0 до 5, где:
5 — идеально правильный и полный ответ,
0 — совершенно неверный или отсутствующий ответ.

Теги вопроса: ${tagsText}
Эти теги являются метаданными. Не завышай и не занижай оценку только из-за тегов.

Вопрос: ${sample.question}
Ответ кандидата: ${sample.candidateAnswer}

Верни результат строго в формате JSON:
{
  "score": <число от 0 до 5>,
  "feedback": "<краткое пояснение>"
}

Если не можешь вернуть JSON, обязательно напиши в конце: "score: X/5"`;
}

function clipText(value, max = 1200) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function extractTextFromUnknownResponseShape(data) {
  if (data == null) {
    return {
      text: '',
      format: 'null',
    };
  }

  if (typeof data === 'string') {
    return {
      text: data,
      format: 'string',
    };
  }

  if (typeof data.response === 'string') {
    return {
      text: data.response,
      format: 'response',
    };
  }

  if (typeof data.text === 'string') {
    return {
      text: data.text,
      format: 'text',
    };
  }

  if (typeof data.output === 'string') {
    return {
      text: data.output,
      format: 'output',
    };
  }

  if (Array.isArray(data.choices) && data.choices.length > 0) {
    const c0 = data.choices[0];

    if (typeof c0?.message?.content === 'string') {
      return {
        text: c0.message.content,
        format: 'choices[0].message.content',
      };
    }

    if (Array.isArray(c0?.message?.content)) {
      const textPart = c0.message.content.find((x) => typeof x?.text === 'string');
      if (textPart?.text) {
        return {
          text: textPart.text,
          format: 'choices[0].message.content[].text',
        };
      }
    }

    if (typeof c0?.text === 'string') {
      return {
        text: c0.text,
        format: 'choices[0].text',
      };
    }

    if (typeof c0?.content === 'string') {
      return {
        text: c0.content,
        format: 'choices[0].content',
      };
    }
  }

  if (Array.isArray(data.outputs) && data.outputs.length > 0) {
    const o0 = data.outputs[0];

    if (typeof o0?.text === 'string') {
      return {
        text: o0.text,
        format: 'outputs[0].text',
      };
    }

    if (typeof o0?.output_text === 'string') {
      return {
        text: o0.output_text,
        format: 'outputs[0].output_text',
      };
    }
  }

  if (Array.isArray(data.content) && data.content.length > 0) {
    const c0 = data.content[0];

    if (typeof c0?.text === 'string') {
      return {
        text: c0.text,
        format: 'content[0].text',
      };
    }

    if (typeof c0 === 'string') {
      return {
        text: c0,
        format: 'content[0]',
      };
    }
  }

  return {
    text: '',
    format: 'unknown',
  };
}

async function parseProviderResponse(response) {
  const status = Number(response?.status || 0);
  const ok = !!response?.ok;

  let rawText = '';
  try {
    rawText = await response.text();
  } catch (err) {
    return {
      ok,
      status,
      rawText: '',
      json: null,
      extractedText: '',
      responseFormat: 'read_error',
      parseError: `Failed to read response body: ${String(err.message || err)}`,
    };
  }

  let json = null;
  try {
    json = rawText ? JSON.parse(rawText) : null;
  } catch {
    json = null;
  }

  const source = json ?? rawText;
  const extracted = extractTextFromUnknownResponseShape(source);

  return {
    ok,
    status,
    rawText,
    json,
    extractedText: extracted.text || '',
    responseFormat: extracted.format,
    parseError: null,
  };
}

function normalizeModelScore(value, scale = 5) {
  const score = Number.parseFloat(value);
  if (!Number.isFinite(score)) return null;

  const denom = Number(scale);
  let normalized = score;

  if (denom === 10) {
    normalized = score / 2;
  } else if (denom !== 5 && denom !== 0) {
    return null;
  }

  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 5) {
    return null;
  }

  return normalized;
}

function parseModelScore(text) {
  if (!text || !String(text).trim()) {
    return { score: null, feedback: null, parseError: true };
  }

  const cleanText = String(text).trim();

  try {
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);

      let rawScore = null;
      if (typeof data.score === 'number') rawScore = data.score;
      else if (typeof data.score === 'string') rawScore = Number.parseFloat(data.score);

      const normalized = normalizeModelScore(rawScore, 5);
      if (Number.isFinite(normalized)) {
        return {
          score: normalized,
          feedback: data.feedback || data.reasoning || null,
          parseError: false,
        };
      }
    }
  } catch {
    // ignore
  }

  const patterns = [
    /score:\s*(\d+(?:\.\d+)?)\s*\/\s*(5|10)/i,
    /оценка:\s*(\d+(?:\.\d+)?)\s*\/\s*(5|10)/i,
    /(\d+(?:\.\d+)?)\s*\/\s*(5|10)/i,
    /score:\s*(\d+(?:\.\d+)?)/i,
    /оценка:\s*(\d+(?:\.\d+)?)/i,
    /final score\s*[:=]\s*(\d+(?:\.\d+)?)/i,
    /^(\d+(?:\.\d+)?)$/m,
  ];

  for (const pattern of patterns) {
    const match = cleanText.match(pattern);
    if (!match) continue;

    const value = match[1];
    const scale = match[2] || 5;
    const normalized = normalizeModelScore(value, scale);

    if (Number.isFinite(normalized)) {
      return {
        score: normalized,
        feedback: cleanText,
        parseError: false,
      };
    }
  }

  return {
    score: null,
    feedback: cleanText,
    parseError: true,
  };
}

function calculateMetrics(results) {
  const validResults = results.filter(
    (r) => !r.parseError && Number.isFinite(r.predictedScore)
  );
  const n = validResults.length;

  if (n === 0) {
    return {
      samples: results.length,
      parseSuccessRate: 0,
      mae: null,
      rmse: null,
      exactRate: 0,
      within1Rate: 0,
      within2Rate: 0,
      meanSignedError: null,
      avgPredictedScore: null,
      parseErrors: results.filter((r) => r.parseError).length,
      emptyResponses: results.filter((r) => !r.rawResponse || !String(r.rawResponse).trim()).length,
      inferenceErrors: results.filter((r) => !!r.inferenceError).length,
    };
  }

  let sumAbsError = 0;
  let sumSqError = 0;
  let sumSignedError = 0;
  let sumPredictedScore = 0;
  let exactCount = 0;
  let within1Count = 0;
  let within2Count = 0;

  for (const r of validResults) {
    const error = r.predictedScore - r.referenceScore;
    const absError = Math.abs(error);

    sumAbsError += absError;
    sumSqError += error * error;
    sumSignedError += error;
    sumPredictedScore += r.predictedScore;

    if (absError === 0) exactCount += 1;
    if (absError <= 1) within1Count += 1;
    if (absError <= 2) within2Count += 1;
  }

  return {
    samples: results.length,
    parseSuccessRate: n / results.length,
    mae: sumAbsError / n,
    rmse: Math.sqrt(sumSqError / n),
    exactRate: exactCount / n,
    within1Rate: within1Count / n,
    within2Rate: within2Count / n,
    meanSignedError: sumSignedError / n,
    avgPredictedScore: sumPredictedScore / n,
    parseErrors: results.filter((r) => r.parseError).length,
    emptyResponses: results.filter((r) => !r.rawResponse || !String(r.rawResponse).trim()).length,
    inferenceErrors: results.filter((r) => !!r.inferenceError).length,
  };
}

function normalizeTarget(target) {
  return {
    id: target.id,
    label: target.label || target.name || target.id,
    modelPath: target.modelPath || target.path || target.model || null,
    loraPath: target.loraPath || null,
    loraName: target.loraName || null,
  };
}

function buildRuntimeParams(target, settings) {
  const inf = settings.inference || {};
  return {
    model: target.modelPath,
    loraPath: target.loraPath || null,
    loraName: target.loraName || null,
    provider: inf.provider || 'auto',
    port: Number(inf.port || CONFIG.vllmPort),
    maxModelLen: inf.maxModelLen,
    gpuMemoryUtilization: Number(inf.gpuMemoryUtilization || 0.7),
    tensorParallelSize: inf.tensorParallelSize,
    quantization: inf.quantization,
    dtype: inf.dtype,
    trustRemoteCode: inf.trustRemoteCode,
    enforceEager: inf.enforceEager,
    kvCacheDtype: inf.kvCacheDtype,
    maxNumSeqs: inf.maxNumSeqs,
    swapSpace: inf.swapSpace,
    baseModel: target.label,
    activeModelId: target.id,
    activeModelName: target.label,
    activeLoraId: null,
    activeLoraName: target.loraName || null,
  };
}

async function runEvaluationBenchmark(jobId, { datasetId, targets, name }) {
  const datasets = await getEvalDatasets();
  const dsMeta = datasets.find((d) => d.id === datasetId);
  if (!dsMeta) throw new Error('Evaluation dataset not found');

  const samples = JSON.parse(fs.readFileSync(dsMeta.jsonPath, 'utf8'));
  const safeTargets = Array.isArray(targets) ? targets.map(normalizeTarget) : [];
  if (!safeTargets.length) throw new Error('No evaluation targets provided');

  const outputDir = path.join(CONFIG.trainingOutputsDir, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(CONFIG.logsDir, { recursive: true });
  const logFile = path.join(CONFIG.logsDir, `${jobId}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  let job = await upsertJob({
    id: jobId,
    name: name || `Eval: ${dsMeta.name}`,
    type: 'eval-benchmark',
    status: 'running',
    createdAt: nowIso(),
    startedAt: nowIso(),
    finishedAt: null,
    datasetId,
    outputDir,
    logFile,
    paramsSnapshot: { datasetId, targets: safeTargets },
    summaryMetrics: {},
    artifacts: [],
    error: null,
    progress: {
      currentStage: 'Initializing',
      totalModels: safeTargets.length,
      processedModels: 0,
      totalSamples: samples.length,
      processedSamples: 0,
      currentModelId: null,
      currentModelName: null,
      currentSampleId: null,
      currentSampleIndex: 0,
      modelProgressPercent: 0,
      totalProgressPercent: 0,
      successCount: 0,
      parseErrorCount: 0,
      inferenceErrorCount: 0,
      lastError: null,
      responseFormat: null,
      updatedAt: nowIso(),
    },
  });

  const writeLog = (msg, level = 'info', meta = null) => {
    let safeLevel = 'info';

    if (typeof level === 'string') {
      const lowered = level.toLowerCase().trim();
      if (['info', 'warn', 'error', 'debug'].includes(lowered)) {
        safeLevel = lowered;
      }
    }

    const timestamp = new Date().toISOString();
    const upperLevel = safeLevel.toUpperCase();

    const line = `[${timestamp}] [${upperLevel}] ${msg}${
      meta ? ` ${JSON.stringify(meta)}` : ''
    }\n`;

    logStream.write(line);

    const colorMap = {
      info: '\x1b[32m',
      warn: '\x1b[33m',
      error: '\x1b[31m',
      debug: '\x1b[34m',
    };
    const color = colorMap[safeLevel] || '\x1b[37m';
    const reset = '\x1b[0m';

    console.log(`${timestamp} ${color}${upperLevel}${reset}: ${msg}`, meta ? meta : '');

    emitEvent('job_log', {
      jobId,
      message: msg,
      level: safeLevel,
      meta: meta || null,
      timestamp,
    });
  };

  const updateProgress = async (patch = {}) => {
    const nextProgress = {
      ...(job.progress || {}),
      ...patch,
      updatedAt: nowIso(),
    };

    job = await upsertJob({
      ...job,
      progress: nextProgress,
    });

    emitEvent('job_updated', job);
    return job;
  };

  const benchmarkResults = [];
  const modelSummaries = [];
  const totalWork = safeTargets.length * samples.length;

  try {
    writeLog('Evaluation started', {
      dataset: dsMeta.name,
      samples: samples.length,
      models: safeTargets.length,
      scoreScale: 5,
    });

    const settings = await getSettings();

    for (let tIdx = 0; tIdx < safeTargets.length; tIdx += 1) {
      const target = safeTargets[tIdx];
      if (!target.modelPath) {
        throw new Error(`Target ${target.label} does not contain modelPath`);
      }

      writeLog(`Starting model ${tIdx + 1}/${safeTargets.length}: ${target.label}`, 'info', {
        targetId: target.id,
        modelPath: target.modelPath,
        loraPath: target.loraPath || null,
      });

      await updateProgress({
        currentStage: `Loading model: ${target.label}`,
        currentModelId: target.id,
        currentModelName: target.label,
        currentSampleId: null,
        currentSampleIndex: 0,
        processedSamples: 0,
        modelProgressPercent: 0,
        successCount: 0,
        parseErrorCount: 0,
        inferenceErrorCount: 0,
        lastError: null,
        responseFormat: null,
      });

      await stopRuntime().catch(() => {});

      const runtimeParams = buildRuntimeParams(target, settings);
      writeLog('Launching runtime', 'info', runtimeParams);

      const runtime = await startRuntime(runtimeParams);
      const providerId = runtime.providerResolved || 'vllm';
      const provider = providers.PROVIDERS[providerId];
      if (!provider) {
        throw new Error(`Provider not found: ${providerId}`);
      }

      writeLog('Runtime ready', 'info', {
        provider: providerId,
        model: runtime.model,
        activeLoraName: runtime.activeLoraName || null,
        probe: runtime.probe || null,
      });

      await updateProgress({
        currentStage: `Evaluating: ${target.label}`,
      });

      const modelResults = [];
      let successCount = 0;
      let parseErrorCount = 0;
      let inferenceErrorCount = 0;
      let sameCriticalParseErrors = 0;
      let lastCriticalParseKey = null;

      for (let i = 0; i < samples.length; i += 1) {
        const sample = samples[i];
        const modelPercent = Math.round(((i + 1) / samples.length) * 100);
        const totalDone = tIdx * samples.length + i + 1;
        const totalPercent = Math.round((totalDone / totalWork) * 100);

        writeLog(
          `[${target.label}] Evaluating sample ${i + 1}/${samples.length}`,
          'info',
          { sampleId: sample.id }
        );

        await updateProgress({
          currentStage: `Evaluating: ${target.label}`,
          currentSampleId: sample.id,
          currentSampleIndex: i + 1,
          processedSamples: i + 1,
          modelProgressPercent: modelPercent,
          totalProgressPercent: totalPercent,
        });

        const prompt = buildEvalPrompt(sample);

        try {
          const response = await provider.chat(runtime, {
            model: runtime.activeLoraName || runtime.activeModelName || runtime.model,
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            max_tokens: 512,
            temperature: 0,
          });

          const parsedResponse = await parseProviderResponse(response);

          if (!parsedResponse.ok) {
            inferenceErrorCount += 1;

            const row = {
              sampleId: sample.id,
              question: sample.question,
              candidateAnswer: sample.candidateAnswer,
              referenceScore: sample.referenceScore,
              maxScore: sample.maxScore || 5,
              hashTags: sample.hashTags || [],
              predictedScore: null,
              predictedFeedback: null,
              rawResponse: parsedResponse.rawText || null,
              parseError: true,
              inferenceError: true,
              errorReason: `http_${parsedResponse.status || 'unknown'}`,
              responseFormat: parsedResponse.responseFormat,
              absoluteError: null,
            };

            modelResults.push(row);

            const lastError = `HTTP ${parsedResponse.status || 'unknown'}`;
            writeLog(`Inference error for sample ${sample.id}`, 'error', {
              status: parsedResponse.status,
              responseFormat: parsedResponse.responseFormat,
              rawPreview: clipText(parsedResponse.rawText, 500),
            });

            await updateProgress({
              successCount,
              parseErrorCount,
              inferenceErrorCount,
              lastError,
              responseFormat: parsedResponse.responseFormat,
            });

            continue;
          }

          if (i < 3) {
            writeLog(`Raw response preview for sample ${sample.id}`, 'info', {
              responseFormat: parsedResponse.responseFormat,
              rawPreview: clipText(parsedResponse.rawText, 800),
            });
          }

          const rawResponse = parsedResponse.extractedText || '';
          const scoreParsed = parseModelScore(rawResponse);

          const row = {
            sampleId: sample.id,
            question: sample.question,
            candidateAnswer: sample.candidateAnswer,
            referenceScore: sample.referenceScore,
            maxScore: sample.maxScore || 5,
            hashTags: sample.hashTags || [],
            predictedScore: scoreParsed.score,
            predictedFeedback: scoreParsed.feedback,
            rawResponse,
            parseError: scoreParsed.parseError,
            inferenceError: false,
            errorReason: scoreParsed.parseError ? 'score_parse_failed' : null,
            responseFormat: parsedResponse.responseFormat,
            absoluteError:
              Number.isFinite(scoreParsed.score)
                ? Math.abs(scoreParsed.score - sample.referenceScore)
                : null,
          };

          modelResults.push(row);

          if (scoreParsed.parseError) {
            parseErrorCount += 1;

            const parseKey = `${parsedResponse.responseFormat}|score_parse_failed`;
            if (parseKey === lastCriticalParseKey) {
              sameCriticalParseErrors += 1;
            } else {
              sameCriticalParseErrors = 1;
              lastCriticalParseKey = parseKey;
            }

            writeLog(`Parse error for sample ${sample.id}`, 'warn', {
              responseFormat: parsedResponse.responseFormat,
              extractedPreview: clipText(rawResponse, 500),
            });

            await updateProgress({
              successCount,
              parseErrorCount,
              inferenceErrorCount,
              lastError: 'score_parse_failed',
              responseFormat: parsedResponse.responseFormat,
            });

            if (sameCriticalParseErrors >= 5 && i < 10) {
              throw new Error(
                `Evaluation stopped early: first samples repeatedly failed to parse model output. responseFormat=${parsedResponse.responseFormat}`
              );
            }
          } else {
            successCount += 1;
            sameCriticalParseErrors = 0;
            lastCriticalParseKey = null;

            await updateProgress({
              successCount,
              parseErrorCount,
              inferenceErrorCount,
              lastError: null,
              responseFormat: parsedResponse.responseFormat,
            });
          }
        } catch (err) {
          inferenceErrorCount += 1;

          writeLog(`Error evaluating sample ${sample.id}`, 'error', {
            error: String(err.message || err),
          });

          modelResults.push({
            sampleId: sample.id,
            question: sample.question,
            candidateAnswer: sample.candidateAnswer,
            referenceScore: sample.referenceScore,
            maxScore: sample.maxScore || 5,
            hashTags: sample.hashTags || [],
            predictedScore: null,
            predictedFeedback: null,
            rawResponse: null,
            parseError: true,
            inferenceError: true,
            errorReason: 'evaluation_exception',
            responseFormat: null,
            error: String(err.message || err),
            absoluteError: null,
          });

          await updateProgress({
            successCount,
            parseErrorCount,
            inferenceErrorCount,
            lastError: String(err.message || err),
          });

          if (String(err.message || err).includes('Evaluation stopped early')) {
            throw err;
          }
        }
      }

      const metrics = calculateMetrics(modelResults);

      modelSummaries.push({
        modelId: target.id,
        modelLabel: target.label,
        ...metrics,
      });

      benchmarkResults.push({
        target,
        runtime: {
          provider: runtime.providerResolved || null,
          model: runtime.model || null,
          activeLoraName: runtime.activeLoraName || null,
        },
        results: modelResults,
        metrics,
      });

      writeLog(`Finished target ${target.label}`, 'info', {
        mae: metrics.mae,
        rmse: metrics.rmse,
        parseErrors: metrics.parseErrors,
        inferenceErrors: metrics.inferenceErrors,
        parseSuccessRate: metrics.parseSuccessRate,
      });

      await updateProgress({
        processedModels: tIdx + 1,
        currentStage: `Completed: ${target.label}`,
      });

      await stopRuntime().catch(() => {});
    }

    writeLog('Saving evaluation artifacts');

    const resultPath = path.join(outputDir, 'result.json');
    fs.writeFileSync(resultPath, JSON.stringify(benchmarkResults, null, 2), 'utf8');

    const summaryCsvPath = path.join(outputDir, 'summary.csv');
    const summaryHeaders = [
      'model',
      'samples',
      'parseSuccessRate',
      'mae',
      'rmse',
      'exactRate',
      'within1Rate',
      'within2Rate',
      'meanSignedError',
      'avgPredictedScore',
      'parseErrors',
      'inferenceErrors',
      'emptyResponses',
    ];

    const summaryRows = modelSummaries.map((m) =>
      [
        csvEscape(m.modelLabel),
        m.samples,
        m.parseSuccessRate,
        m.mae,
        m.rmse,
        m.exactRate,
        m.within1Rate,
        m.within2Rate,
        m.meanSignedError,
        m.avgPredictedScore,
        m.parseErrors,
        m.inferenceErrors,
        m.emptyResponses,
      ].join(',')
    );

    fs.writeFileSync(summaryCsvPath, [summaryHeaders.join(','), ...summaryRows].join('\n'));

    const detailedCsvPath = path.join(outputDir, 'detailed.csv');
    const detailedHeaders = [
      'sampleId',
      'modelId',
      'modelLabel',
      'referenceScore',
      'maxScore',
      'predictedScore',
      'absoluteError',
      'parseError',
      'inferenceError',
      'errorReason',
      'responseFormat',
      'hashTags',
      'question',
      'candidateAnswer',
      'predictedFeedback',
      'rawResponse',
    ];

    const detailedRows = [];
    for (const modelRun of benchmarkResults) {
      for (const r of modelRun.results) {
        detailedRows.push(
          [
            csvEscape(r.sampleId),
            csvEscape(modelRun.target.id),
            csvEscape(modelRun.target.label),
            r.referenceScore,
            r.maxScore ?? 5,
            r.predictedScore,
            r.absoluteError,
            r.parseError,
            !!r.inferenceError,
            csvEscape(r.errorReason || ''),
            csvEscape(r.responseFormat || ''),
            csvEscape(Array.isArray(r.hashTags) ? r.hashTags.join(', ') : ''),
            csvEscape(r.question || ''),
            csvEscape(r.candidateAnswer || ''),
            csvEscape(r.predictedFeedback || ''),
            csvEscape(r.rawResponse || ''),
          ].join(',')
        );
      }
    }

    fs.writeFileSync(detailedCsvPath, [detailedHeaders.join(','), ...detailedRows].join('\n'));

    const summary = {
      dataset: {
        id: dsMeta.id,
        name: dsMeta.name,
        samples: samples.length,
        scoreScale: 5,
      },
      models: modelSummaries,
      totals: {
        models: safeTargets.length,
        samples: samples.length,
        comparisons: totalWork,
      },
    };

    const summaryJsonPath = path.join(outputDir, 'summary.json');
    fs.writeFileSync(summaryJsonPath, JSON.stringify(summary, null, 2), 'utf8');

    job = await upsertJob({
      ...job,
      status: 'completed',
      finishedAt: nowIso(),
      error: null,
      summaryMetrics: summary,
      artifacts: [
        { name: 'result.json', path: resultPath, size: fs.statSync(resultPath).size },
        { name: 'summary.json', path: summaryJsonPath, size: fs.statSync(summaryJsonPath).size },
        { name: 'summary.csv', path: summaryCsvPath, size: fs.statSync(summaryCsvPath).size },
        { name: 'detailed.csv', path: detailedCsvPath, size: fs.statSync(detailedCsvPath).size },
      ],
      progress: {
        ...(job.progress || {}),
        currentStage: 'Completed',
        processedModels: safeTargets.length,
        processedSamples: samples.length,
        currentSampleId: null,
        currentSampleIndex: samples.length,
        modelProgressPercent: 100,
        totalProgressPercent: 100,
        updatedAt: nowIso(),
      },
    });

    emitEvent('job_updated', job);
    writeLog('Evaluation completed successfully');
  } catch (err) {
    await stopRuntime().catch(() => {});

    const message = String(err.message || err);
    writeLog(`CRITICAL ERROR: ${message}`, 'error');

    job = await upsertJob({
      ...job,
      status: 'failed',
      finishedAt: nowIso(),
      error: message,
      progress: {
        ...(job.progress || {}),
        currentStage: 'Failed',
        lastError: message,
        updatedAt: nowIso(),
      },
    });

    emitEvent('job_updated', job);
  } finally {
    logStream.end();
  }
}

async function importEvalDataset(name, text) {
  const { samples, errors } = parseEvalTxt(text, name);
  if (samples.length === 0) {
    throw new Error(
      'No valid evaluation samples found. ' + (errors[0]?.error || 'Check the format.')
    );
  }

  const id = uid('eval-ds');
  const jsonPath = path.join(CONFIG.evalDatasetsDir, `${id}.json`);
  const txtPath = path.join(CONFIG.evalDatasetsDir, `${id}.txt`);

  fs.mkdirSync(CONFIG.evalDatasetsDir, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(samples, null, 2), 'utf8');
  fs.writeFileSync(txtPath, text, 'utf8');

  const meta = {
    id,
    name,
    samplesCount: samples.length,
    scoreScale: 5,
    jsonPath,
    txtPath,
    createdAt: nowIso(),
  };

  await addEvalDataset(meta);
  return meta;
}

module.exports = {
  importEvalDataset,
  runEvaluationBenchmark,
  parseEvalTxt,
  parseModelScore,
  calculateMetrics,
};