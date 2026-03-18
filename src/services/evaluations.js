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
  const blocks = content.split(/\n(?=Вопрос:)/g);

  for (const block of blocks) {
    const qMatch = block.match(/Вопрос:\s*([\s\S]*?)(?=\nОтвет:|$)/i);
    const aMatch = block.match(/Ответ:\s*([\s\S]*?)(?=\nОценка:|$)/i);
    const sMatch = block.match(/Оценка:\s*(\d+(?:\.\d+)?)\/10/i);

    if (qMatch && aMatch && sMatch) {
      samples.push({
        id: uid('sample'),
        question: qMatch[1].trim(),
        candidateAnswer: aMatch[1].trim(),
        referenceScore: parseFloat(sMatch[1]),
        sourceFile: sourceName,
        topic: null
      });
    }
  }

  return samples;
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
    // Look for JSON-like block if not pure JSON
    const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      if (typeof data.score === 'number') {
        return {
          score: data.score,
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
    /(\d+(?:\.\d+)?)\/10/,
    /(\d+(?:\.\d+)?)\s*из\s*10/i,
    /^(\d+(?:\.\d+)?)$/m, // Just a number on a line
  ];

  for (const pattern of patterns) {
    const match = cleanText.match(pattern);
    if (match) {
      return {
        score: parseFloat(match[1]),
        feedback: cleanText,
        parseError: false
      };
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
    meanSignedError: null
  };

  let sumAbsError = 0;
  let sumSqError = 0;
  let sumSignedError = 0;
  let exactCount = 0;
  let within1Count = 0;
  let within2Count = 0;

  for (const r of validResults) {
    const error = r.predictedScore - r.referenceScore;
    const absError = Math.abs(error);

    sumAbsError += absError;
    sumSqError += error * error;
    sumSignedError += error;

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
    meanSignedError: sumSignedError / n
  };
}

async function runEvaluationBenchmark(jobId, { datasetId, targets }) {
  const datasets = await getEvalDatasets();
  const dsMeta = datasets.find(d => d.id === datasetId);
  if (!dsMeta) throw new Error('Evaluation dataset not found');

  const samples = JSON.parse(fs.readFileSync(dsMeta.jsonPath, 'utf8'));
  const job = await upsertJob({ id: jobId, status: 'running', startedAt: nowIso() });

  const outputDir = path.join(CONFIG.trainingOutputsDir, jobId);
  fs.mkdirSync(outputDir, { recursive: true });
  const logFile = path.join(CONFIG.logsDir, `${jobId}.log`);
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  const writeLog = (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    logStream.write(line);
    logger.info(`Eval ${jobId}: ${msg}`);
  };

  const benchmarkResults = [];
  const modelSummaries = [];

  try {
    for (const target of targets) {
      writeLog(`Starting evaluation for target: ${target.label} (${target.id})`);

      // Start runtime for this model
      // target might be a model or a lora.
      // If it has modelId, it's likely a lora. If it has id, it might be the model path.
      const runtimeParams = {
        model: target.modelPath,
        loraPath: target.loraPath || null,
        loraName: target.loraName || null,
        // use lower memory since we just do inference
        gpuMemoryUtilization: 0.7,
      };

      writeLog(`Launching runtime for ${target.label}...`);
      const runtime = await startRuntime(runtimeParams);
      const providerId = runtime.providerResolved;
      const provider = providers.PROVIDERS[providerId];

      const modelResults = [];

      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        writeLog(`[${target.label}] Evaluating sample ${i+1}/${samples.length}`);

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
          // Inference
          const response = await provider.chat(runtime, {
            messages: [{ role: 'user', content: prompt }],
            stream: false,
            max_tokens: 512,
            temperature: 0,
          });

          const rawResponse = response.choices[0].message.content;
          const parsed = parseModelScore(rawResponse);

          const result = {
            sampleId: sample.id,
            question: sample.question,
            candidateAnswer: sample.candidateAnswer,
            referenceScore: sample.referenceScore,
            predictedScore: parsed.score,
            predictedFeedback: parsed.feedback,
            rawResponse: rawResponse,
            parseError: parsed.parseError,
            absoluteError: parsed.score !== null ? Math.abs(parsed.score - sample.referenceScore) : null,
          };

          modelResults.push(result);
        } catch (err) {
          writeLog(`Error evaluating sample ${sample.id}: ${err.message}`);
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

      writeLog(`Finished target ${target.label}. MAE: ${metrics.mae?.toFixed(3) || 'N/A'}`);

      // Stop runtime before next target to free VRAM
      await stopRuntime();
    }

    // Save artifacts
    const resultPath = path.join(outputDir, 'result.json');
    fs.writeFileSync(resultPath, JSON.stringify(benchmarkResults, null, 2));

    // Summary CSV
    const summaryCsvPath = path.join(outputDir, 'summary.csv');
    const summaryHeaders = ['model', 'samples', 'parseSuccessRate', 'mae', 'rmse', 'exactRate', 'within1Rate', 'within2Rate', 'meanSignedError'];
    const summaryRows = modelSummaries.map(m => [
      m.modelLabel, m.samples, m.parseSuccessRate, m.mae, m.rmse, m.exactRate, m.within1Rate, m.within2Rate, m.meanSignedError
    ].join(','));
    fs.writeFileSync(summaryCsvPath, [summaryHeaders.join(','), ...summaryRows].join('\n'));

    // Detailed CSV
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

    emitEvent('job_updated', { id: jobId, status: 'completed' });

  } catch (err) {
    writeLog(`CRITICAL ERROR: ${err.message}`);
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
  const samples = parseEvalTxt(text, name);
  if (samples.length === 0) {
    throw new Error('No valid evaluation samples found in the text. Check the format: Вопрос: / Ответ: / Оценка: x/10');
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
