const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config');
const { nowIso, uid } = require('../utils/ids');
const { getEvalDatasets, addEvalDataset, removeEvalDataset, upsertJob, getJobs, getSettings } = require('./state');
const { emitEvent } = require('./events');
const logger = require('../utils/logger');
const { startRuntime, stopRuntime } = require('./runtime');

// We can't import from '../lib/api' because it's frontend code.
// We should use the providers service directly for inference during evaluation.
const providers = require('./providers');

/**
 * Parses the unified eval text format.
 *
 * Format:
 * Вопрос: ...
 * Ответ: ...
 * Оценка: x/10
 */
function parseEvalTxt(content, sourceName = 'unknown') {
  const samples = [];
  const errors = [];
  // Split by double newline to separate potential blocks
  const blocks = content.replace(/\r\n/g, '\n').split(/\n\n+/);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block) continue;

    const qMatch = block.match(/Вопрос:\s*([\s\S]*?)(?=\nОтвет:|$)/i);
    const aMatch = block.match(/Ответ:\s*([\s\S]*?)(?=\nОценка:|$)/i);
    const sMatch = block.match(/Оценка:\s*(\d+(?:\.\d+)?)\/10/i);

    if (qMatch && aMatch && sMatch) {
      const score = parseFloat(sMatch[1]);
      if (isNaN(score) || score < 0 || score > 10) {
        errors.push({ index: i, error: 'Оценка должна быть числом от 0 до 10', raw: block.slice(0, 100) });
        continue;
      }

      samples.push({
        id: uid('sample'),
        question: qMatch[1].trim(),
        candidateAnswer: aMatch[1].trim(),
        referenceScore: score,
        sourceFile: sourceName,
        topic: null
      });
    } else {
      const missing = [];
      if (!qMatch) missing.push('Вопрос');
      if (!aMatch) missing.push('Ответ');
      if (!sMatch) missing.push('Оценка (x/10)');
      errors.push({ index: i, error: `Отсутствуют поля: ${missing.join(', ')}`, raw: block.slice(0, 100) });
    }
  }

  return { samples, errors };
}

/**
 * Robust score parsing from model response.
 * Handles JSON, "Оценка: X/10", "score: X", or just "X/10".
 */
function parseModelScore(text) {
  if (!text) return { score: null, feedback: null, parseError: true };

  const cleanText = text.trim();

  // Try JSON first
  try {
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      let score = null;
      if (typeof data.score === 'number') score = data.score;
      else if (typeof data.score === 'string') score = parseFloat(data.score);

      if (score !== null && !isNaN(score)) {
        return {
          score: score,
          feedback: data.feedback || data.reasoning || null,
          parseError: false
        };
      }
    }
  } catch (e) {
    // ignore
  }

  // Regex fallbacks
  const patterns = [
    /Оценка:\s*(\d+(?:\.\d+)?)/i,
    /score:\s*(\d+(?:\.\d+)?)/i,
    /Score:\s*(\d+(?:\.\d+)?)/i,
    /Итог:\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\/10/,
    /(\d+(?:\.\d+)?)\s*из\s*10/i,
    /Final score\s*=\s*(\d+(?:\.\d+)?)/i,
    /^(\d+(?:\.\d+)?)$/m, // Just a number on a line
  ];

  for (const pattern of patterns) {
    const match = cleanText.match(pattern);
    if (match) {
      const score = parseFloat(match[1]);
      if (!isNaN(score)) {
        return {
          score: score,
          feedback: cleanText,
          parseError: false
        };
      }
    }
  }

  return { score: null, feedback: cleanText, parseError: true };
}

function calculateMetrics(results) {
  const validResults = results.filter(r => !r.parseError && r.predictedScore !== null);
  const n = validResults.length;

  if (n === 0) return {
    samples: results.length,
    parseSuccessRate: 0,
    mae: null,
    rmse: null,
    exactRate: 0,
    within1Rate: 0,
    within2Rate: 0,
    meanSignedError: null,
    avgPredictedScore: null,
    parseErrors: results.filter(r => r.parseError).length,
    emptyResponses: results.filter(r => !r.rawResponse || r.rawResponse.trim() === '').length
  };

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

    if (absError === 0) exactCount++;
    if (absError <= 1) within1Count++;
    if (absError <= 2) within2Count++;

    r.absoluteError = absError;
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
    parseErrors: results.filter(r => r.parseError).length,
    emptyResponses: results.filter(r => !r.rawResponse || r.rawResponse.trim() === '').length
  };
}

async function runEvaluationBenchmark(jobId, { datasetId, targets, name }) {
  const datasets = await getEvalDatasets();
  const dsMeta = datasets.find(d => d.id === datasetId);
  if (!dsMeta) throw new Error('Evaluation dataset not found');

  const samples = JSON.parse(fs.readFileSync(dsMeta.jsonPath, 'utf8'));

  let job = await upsertJob({
    id: jobId,
    name: name || `Eval: ${dsMeta.name}`,
    type: 'eval-benchmark',
    status: 'running',
    startedAt: nowIso(),
    datasetId,
    paramsSnapshot: { datasetId, targets },
    progress: {
      currentStage: 'Initializing',
      totalModels: targets.length,
      processedModels: 0,
      totalSamples: samples.length,
      processedSamples: 0,
      totalProgressPercent: 0
    }
  });

  const outputDir = path.join(CONFIG.trainingOutputsDir, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const logFile = path.join(CONFIG.logsDir, `${jobId}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const writeLog = (msg, level = 'info') => {
    const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}\n`;
    logStream.write(line);
    if (level === 'error') logger.error(`Eval ${jobId}: ${msg}`);
    else logger.info(`Eval ${jobId}: ${msg}`);
    emitEvent('job_log', { jobId, message: msg, level, timestamp: new Date().toISOString() });
  };

  const updateProgress = async (patch) => {
    job = await upsertJob({
      id: jobId,
      progress: { ...(job.progress || {}), ...patch, updatedAt: nowIso() }
    });
    emitEvent('job_updated', job);
  };

  const benchmarkResults = [];
  const modelSummaries = [];

  try {
    writeLog(`Evaluation started. Dataset: ${dsMeta.name} (${samples.length} samples), Models: ${targets.length}`);

    for (let tIdx = 0; tIdx < targets.length; tIdx++) {
      const target = targets[tIdx];
      writeLog(`[${tIdx + 1}/${targets.length}] Starting evaluation for target: ${target.label}`);

      await updateProgress({
        currentStage: `Loading model: ${target.label}`,
        currentModelId: target.id,
        currentModelName: target.label,
        modelProgressPercent: 0,
        processedSamples: 0
      });

      const runtimeParams = {
        model: target.modelPath,
        loraPath: target.loraPath || null,
        loraName: target.loraName || null,
        gpuMemoryUtilization: 0.7,
      };

      writeLog(`Launching runtime for ${target.label}...`);
      const runtime = await startRuntime(runtimeParams);
      const providerId = runtime.providerResolved;
      const provider = providers.PROVIDERS[providerId];
      writeLog(`Runtime ready (Provider: ${providerId})`);

      await updateProgress({ currentStage: `Evaluating: ${target.label}` });

      const modelResults = [];

      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        const sampleProgress = Math.round(((i + 1) / samples.length) * 100);

        if (i % 5 === 0 || i === samples.length - 1) {
          writeLog(`[${target.label}] Progress: ${i + 1}/${samples.length} (${sampleProgress}%)`);
          await updateProgress({
            processedSamples: i + 1,
            modelProgressPercent: sampleProgress,
            totalProgressPercent: Math.round(((tIdx * samples.length + i + 1) / (targets.length * samples.length)) * 100)
          });
        }

        const prompt = `Ты — беспристрастный эксперт-оценщик. Тебе предоставлен вопрос и ответ кандидата.
Твоя задача — выставить оценку от 0 до 10, где 10 — идеально правильный и полный ответ, а 0 — совершенно неверный или отсутствующий ответ.

Вопрос: ${sample.question}
Ответ кандидата: ${sample.candidateAnswer}

Верни результат в формате JSON:
{
  "score": <число от 0 до 10>,
  "feedback": "<краткое пояснение>"
}

Если не можешь вернуть JSON, обязательно напиши в конце: "Оценка: X/10"`;

        try {
          const response = await provider.chat(runtime, {
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            max_tokens: 512,
            temperature: 0,
          });

          const rawResponse = response.choices[0]?.message?.content || '';
          const parsed = parseModelScore(rawResponse);

          if (parsed.parseError) {
            writeLog(`Parse error for sample ${sample.id} in model ${target.label}. Raw: ${rawResponse.slice(0, 50)}...`, 'warn');
          }

          modelResults.push({
            sampleId: sample.id,
            question: sample.question,
            candidateAnswer: sample.candidateAnswer,
            referenceScore: sample.referenceScore,
            predictedScore: parsed.score,
            predictedFeedback: parsed.feedback,
            rawResponse: rawResponse,
            parseError: parsed.parseError,
            absoluteError: parsed.score !== null ? Math.abs(parsed.score - sample.referenceScore) : null,
          });
        } catch (err) {
          writeLog(`Error evaluating sample ${sample.id}: ${err.message}`, 'error');
          modelResults.push({
            sampleId: sample.id,
            question: sample.question,
            candidateAnswer: sample.candidateAnswer,
            referenceScore: sample.referenceScore,
            predictedScore: null,
            predictedFeedback: null,
            rawResponse: null,
            parseError: true,
            error: err.message,
            absoluteError: null,
          });
        }
      }

      const metrics = calculateMetrics(modelResults);
      modelSummaries.push({
        modelId: target.id,
        modelLabel: target.label,
        ...metrics
      });

      benchmarkResults.push({
        target,
        results: modelResults,
        metrics
      });

      writeLog(`Finished target ${target.label}. MAE: ${metrics.mae?.toFixed(3) || 'N/A'}, Parse Errors: ${metrics.parseErrors}`);

      await updateProgress({ processedModels: tIdx + 1 });
      await stopRuntime();
    }

    writeLog('Saving results and artifacts...');
    await updateProgress({ currentStage: 'Saving results' });

    const resultPath = path.join(outputDir, 'result.json');
    fs.writeFileSync(resultPath, JSON.stringify(benchmarkResults, null, 2));

    const summaryCsvPath = path.join(outputDir, 'summary.csv');
    const summaryHeaders = ['model', 'samples', 'parseSuccessRate', 'mae', 'rmse', 'exactRate', 'within1Rate', 'within2Rate', 'meanSignedError', 'avgPredictedScore'];
    const summaryRows = modelSummaries.map(m => [
      m.modelLabel, m.samples, m.parseSuccessRate, m.mae, m.rmse, m.exactRate, m.within1Rate, m.within2Rate, m.meanSignedError, m.avgPredictedScore
    ].join(','));
    fs.writeFileSync(summaryCsvPath, [summaryHeaders.join(','), ...summaryRows].join('\n'));

    const detailedCsvPath = path.join(outputDir, 'detailed.csv');
    const detailedHeaders = ['sampleId', 'modelId', 'modelLabel', 'referenceScore', 'predictedScore', 'absoluteError', 'parseError', 'question', 'candidateAnswer', 'predictedFeedback', 'rawResponse'];
    const detailedRows = [];
    for (const modelRun of benchmarkResults) {
      for (const r of modelRun.results) {
        detailedRows.push([
          r.sampleId, modelRun.target.id, modelRun.target.label, r.referenceScore, r.predictedScore, r.absoluteError, r.parseError,
          `"${(r.question || '').replace(/"/g, '""')}"`,
          `"${(r.candidateAnswer || '').replace(/"/g, '""')}"`,
          `"${(r.predictedFeedback || '').replace(/"/g, '""')}"`,
          `"${(r.rawResponse || '').replace(/"/g, '""')}"`
        ].join(','));
      }
    }
    fs.writeFileSync(detailedCsvPath, [detailedHeaders.join(','), ...detailedRows].join('\n'));

    await upsertJob({
      id: jobId,
      status: 'completed',
      finishedAt: nowIso(),
      summaryMetrics: {
        models: modelSummaries
      },
      artifacts: [
        { name: 'result.json', path: resultPath, size: fs.statSync(resultPath).size },
        { name: 'summary.csv', path: summaryCsvPath, size: fs.statSync(summaryCsvPath).size },
        { name: 'detailed.csv', path: detailedCsvPath, size: fs.statSync(detailedCsvPath).size },
      ]
    });

    writeLog('Evaluation completed successfully.');
    emitEvent('job_updated', { id: jobId, status: 'completed' });

  } catch (err) {
    writeLog(`CRITICAL ERROR: ${err.message}`, 'error');
    await upsertJob({
      id: jobId,
      status: 'failed',
      finishedAt: nowIso(),
      error: err.message
    });
    emitEvent('job_updated', { id: jobId, status: 'failed', error: err.message });
  } finally {
    logStream.end();
  }
}

async function importEvalDataset(name, text) {
  const { samples, errors } = parseEvalTxt(text, name);
  if (samples.length === 0) {
    throw new Error('No valid evaluation samples found. ' + (errors[0]?.error || 'Check the format.'));
  }

  const id = uid('eval-ds');
  const jsonPath = path.join(CONFIG.evalDatasetsDir, `${id}.json`);
  const txtPath = path.join(CONFIG.evalDatasetsDir, `${id}.txt`);

  fs.mkdirSync(CONFIG.evalDatasetsDir, { recursive: true });
  fs.writeFileSync(jsonPath, JSON.stringify(samples, null, 2));
  fs.writeFileSync(txtPath, text);

  const meta = {
    id,
    name,
    samplesCount: samples.length,
    jsonPath,
    txtPath,
    createdAt: nowIso()
  };

  await addEvalDataset(meta);
  return meta;
}

module.exports = {
  importEvalDataset,
  runEvaluationBenchmark,
  parseEvalTxt,
  parseModelScore,
  calculateMetrics
};
