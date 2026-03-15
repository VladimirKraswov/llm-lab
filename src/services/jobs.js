const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG } = require('../config');
const { nowIso, uid } = require('../utils/ids');
const { isPidRunning, killProcessGroup } = require('../utils/proc');
const { getSettings, getDatasets, getJobs, upsertJob, getModelById } = require('./state');
const { emitEvent } = require('./events');
const { readText } = require('../utils/fs');
const { registerLoraFromJob } = require('./loras');
const { runSyntheticGenJob } = require('./synthetic');
const { createDatasetFromJsonl } = require('./datasets');
const logger = require('../utils/logger');
const { clearGpuMemory } = require('../utils/gpu');
const { spawnPythonJsonScript } = require('../utils/python-runner');
const { getModelMetadata } = require('../utils/model-meta');
const {
  registerManagedProcess,
  unregisterManagedProcess,
} = require('../utils/managed-processes');

async function getEnvSnapshot() {
  try {
    const code = `
import sys
import torch
import transformers
import unsloth
import json
try:
    unsloth_version = getattr(unsloth, "__version__", "unknown")
except:
    unsloth_version = "unknown"
print(json.dumps({
    "python": sys.version.split()[0],
    "torch": torch.__version__,
    "transformers": transformers.__version__,
    "unsloth": unsloth_version
}))
`;
    const { exec } = require('child_process');
    const output = await new Promise((resolve, reject) => {
      exec(`${CONFIG.pythonBin} -c '${code.replace(/'/g, "'\\''")}'`, { timeout: 10000 }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
    return JSON.parse(output);
  } catch (err) {
    logger.warn('Failed to get env snapshot', { error: err.message });
    return {
      python: 'unknown',
      torch: 'unknown',
      transformers: 'unknown',
      unsloth: 'unknown',
    };
  }
}

async function getDatasetSnapshot(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { path: filePath, size: 0, mtime: null, hash: null };
    const stats = fs.statSync(filePath);

    let hash = null;
    // For files up to 500MB, we calculate a hash asynchronously
    if (stats.size < 500 * 1024 * 1024) {
      try {
        hash = await new Promise((resolve, reject) => {
          const stream = fs.createReadStream(filePath);
          const md5 = crypto.createHash('md5');
          stream.on('data', (data) => md5.update(data));
          stream.on('end', () => resolve(md5.digest('hex')));
          stream.on('error', (err) => reject(err));
        });
      } catch (err) {
        logger.warn('Failed to get dataset hash', { filePath, error: err.message });
      }
    }

    return {
      path: filePath,
      size: stats.size,
      mtime: stats.mtime.toISOString(),
      hash,
    };
  } catch (err) {
    return { path: filePath, size: 0, mtime: null, hash: null };
  }
}

function getArtifacts(outputDir) {
  try {
    if (!fs.existsSync(outputDir)) return [];
    const files = fs.readdirSync(outputDir);
    return files.map((file) => {
      const filePath = path.join(outputDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        path: filePath,
      };
    });
  } catch (err) {
    return [];
  }
}

function validateQLoraParams(params) {
  if (params.learningRate !== undefined && (typeof params.learningRate !== 'number' || params.learningRate <= 0)) {
    throw new Error('learningRate must be a positive number');
  }
  if (params.numTrainEpochs !== undefined && (!Number.isInteger(params.numTrainEpochs) || params.numTrainEpochs < 1)) {
    throw new Error('numTrainEpochs must be an integer >= 1');
  }
  if (params.perDeviceTrainBatchSize !== undefined && (!Number.isInteger(params.perDeviceTrainBatchSize) || params.perDeviceTrainBatchSize < 1)) {
    throw new Error('perDeviceTrainBatchSize must be an integer >= 1');
  }
  if (params.gradientAccumulationSteps !== undefined && (!Number.isInteger(params.gradientAccumulationSteps) || params.gradientAccumulationSteps < 1)) {
    throw new Error('gradientAccumulationSteps must be an integer >= 1');
  }
  if (params.maxSeqLength !== undefined && (!Number.isInteger(params.maxSeqLength) || params.maxSeqLength < 1)) {
    throw new Error('maxSeqLength must be an integer >= 1');
  }
}

function buildTrainingEnv(settings) {
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
  };

  const wandb = settings.wandb || {};

  if (wandb.httpProxy) {
    env.HTTP_PROXY = wandb.httpProxy;
    env.http_proxy = wandb.httpProxy;
  }

  if (wandb.httpsProxy) {
    env.HTTPS_PROXY = wandb.httpsProxy;
    env.https_proxy = wandb.httpsProxy;
  }

  if (wandb.noProxy) {
    env.NO_PROXY = wandb.noProxy;
    env.no_proxy = wandb.noProxy;
  }

  if (wandb.baseUrl) {
    env.WANDB_BASE_URL = wandb.baseUrl;
  }

  if (wandb.mode) {
    env.WANDB_MODE = wandb.mode;
  }

  return env;
}

async function startFineTuneJob({ datasetId, name, modelId, baseModel, qlora }) {
  if (qlora) validateQLoraParams(qlora);

  await clearGpuMemory({ types: ['runtime', 'fine-tune'] });

  const settings = await getSettings();
  const datasets = await getDatasets();
  const ds = datasets.find((x) => x.id === datasetId);
  if (!ds) throw new Error('dataset not found');

  let selectedBaseModel = baseModel || settings.baseModel;
  let selectedModelId = modelId || null;

  if (modelId) {
    const model = await getModelById(modelId);
    if (!model) throw new Error('model not found');
    if (model.status !== 'ready') throw new Error('model is not ready');
    selectedBaseModel = model.path;
  }

  const jobId = uid('job');
  const outputDir = path.join(CONFIG.trainingOutputsDir, jobId);
  const logFile = path.join(CONFIG.logsDir, `${jobId}.log`);

  const trainConfig = {
    baseModel: selectedBaseModel,
    datasetPath: ds.processedPath,
    outputDir,
    qlora: { ...settings.qlora, ...(qlora || {}) },
    wandb: settings.wandb || {},
  };

  const [envSnapshot, datasetSnapshot] = await Promise.all([
    getEnvSnapshot(),
    getDatasetSnapshot(ds.processedPath),
  ]);

  const job = {
    id: jobId,
    type: 'fine-tune',
    name: name || jobId,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    datasetId,
    datasetPath: ds.processedPath,
    modelId: selectedModelId,
    baseModel: selectedBaseModel,
    qlora: qlora || {},
    outputDir,
    logFile,
    pid: null,
    error: null,
    configPath: null,
    paramsSnapshot: trainConfig,
    datasetSnapshot,
    modelSnapshot: {
      path: selectedBaseModel,
      ...getModelMetadata(selectedBaseModel),
    },
    envSnapshot,
    tags: [],
    notes: '',
    artifacts: [],
    summaryMetrics: {},
  };

  await upsertJob(job);
  emitEvent('job_updated', job);
  logger.info(`Starting fine-tune job: ${job.name}`, {
    jobId,
    datasetId,
    baseModel: selectedBaseModel,
  });

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(CONFIG.logsDir, { recursive: true });
  fs.mkdirSync(CONFIG.trainingConfigsDir, { recursive: true });

  const outFd = fs.openSync(logFile, 'a');
  const scriptPath = path.join(__dirname, '..', 'python', 'train.py');

  const { child, configPath } = await spawnPythonJsonScript({
    pythonBin: CONFIG.pythonBin,
    scriptPath,
    payload: trainConfig,
    cwd: CONFIG.workspace,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: buildTrainingEnv(settings),
    configDir: CONFIG.trainingConfigsDir,
    configPrefix: jobId,
    logLabel: `fine-tune:${jobId}`,
  });

  child.unref();

  await registerManagedProcess({
    pid: child.pid,
    type: 'fine-tune',
    label: `fine-tune:${jobId}`,
    meta: {
      jobId,
      datasetId,
      outputDir,
      logFile,
      baseModel: selectedBaseModel,
    },
  });

  const runningJob = await upsertJob({
    ...job,
    status: 'running',
    startedAt: nowIso(),
    pid: child.pid,
    configPath,
  });
  emitEvent('job_updated', runningJob);

  child.on('exit', async (code) => {
    await unregisterManagedProcess(child.pid);

    logger.info('Fine-tune process exited', {
      jobId,
      code,
      configPath,
    });

    const jobs = await getJobs();
    const current = jobs.find((j) => j.id === jobId);
    if (!current) return;

    const patch = {
      status: code === 0 ? 'completed' : 'failed',
      finishedAt: nowIso(),
      error: code === 0 ? null : `trainer exited with code ${code}`,
      pid: null,
      configPath,
    };

    if (code === 0) {
      const summaryFile = path.join(current.outputDir, 'summary.json');
      if (fs.existsSync(summaryFile)) {
        try {
          patch.summaryMetrics = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
        } catch (err) {
          logger.warn('Failed to read summary.json', { jobId, error: err.message });
        }
      }
      patch.artifacts = getArtifacts(current.outputDir);
    }

    const next = await upsertJob({
      ...current,
      ...patch,
    });

    emitEvent('job_updated', next);

    if (code === 0) {
      logger.info(`Job completed: ${jobId}`, { configPath });
    } else {
      logger.error(`Job failed: ${jobId}`, {
        code,
        error: next.error,
        configPath,
      });
    }

    if (code === 0) {
      try {
        await registerLoraFromJob(jobId);
      } catch (err) {
        emitEvent('lora_register_failed', {
          jobId,
          error: String(err.message || err),
        });

        logger.error('LoRA auto-registration failed after fine-tune', {
          jobId,
          configPath,
          error: String(err.message || err),
        });
      }
    }
  });

  child.on('error', async (err) => {
    await unregisterManagedProcess(child.pid);

    logger.error('Fine-tune process error', {
      jobId,
      configPath,
      error: String(err.message || err),
    });

    const jobs = await getJobs();
    const current = jobs.find((j) => j.id === jobId);
    if (!current) return;

    const next = await upsertJob({
      ...current,
      status: 'failed',
      finishedAt: nowIso(),
      error: String(err.message || err),
      pid: null,
      configPath,
    });

    emitEvent('job_updated', next);
  });

  return {
    ok: true,
    jobId,
    logFile,
    outputDir,
    configPath,
  };
}

async function updateJobMetadata(jobId, { tags, notes }) {
  const current = await getJobById(jobId);
  const next = await upsertJob({
    ...current,
    tags: tags !== undefined ? tags : current.tags,
    notes: notes !== undefined ? notes : current.notes,
  });
  emitEvent('job_updated', next);
  return next;
}

async function stopJob(jobId) {
  const jobs = await getJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('job not found');

  if (!job.pid || !isPidRunning(job.pid)) {
    if (job.status === 'running') {
      await upsertJob({
        ...job,
        status: 'failed',
        finishedAt: nowIso(),
        error: 'Process not found',
      });
    }
    throw new Error('job is not running');
  }

  await killProcessGroup(job.pid);
  await unregisterManagedProcess(job.pid);

  const next = await upsertJob({
    ...job,
    status: 'stopped',
    finishedAt: nowIso(),
    pid: null,
  });

  emitEvent('job_updated', next);
  logger.info('Job stopped', { jobId });

  return { ok: true };
}

async function getJobById(id) {
  const jobs = await getJobs();
  const job = jobs.find((x) => x.id === id);
  if (!job) throw new Error('job not found');
  return job;
}

async function getJobLogs(id, tail = 200) {
  const job = await getJobById(id);
  const text = await readText(job.logFile, '');
  const lines = text.split('\n');

  return {
    id: job.id,
    logFile: job.logFile,
    content: lines.slice(-tail).join('\n'),
  };
}

async function startSyntheticGenJob(cfg) {
  const jobId = uid('job');
  const outputDir = path.join(CONFIG.syntheticDir, jobId);
  const logFile = path.join(CONFIG.logsDir, `${jobId}.log`);

  const job = {
    id: jobId,
    type: 'synthetic-gen',
    name: cfg.name || jobId,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    paramsSnapshot: cfg,
    outputDir,
    logFile,
    pid: process.pid, // We are running it in-process for now or it's managed by this job
    error: null,
    tags: [],
    notes: '',
    artifacts: [],
    summaryMetrics: {},
  };

  await upsertJob(job);
  emitEvent('job_updated', job);

  // Background execution
  (async () => {
    try {
      const runningJob = await upsertJob({
        ...job,
        status: 'running',
        startedAt: nowIso(),
      });
      emitEvent('job_updated', runningJob);

      const updateStatus = async (step) => {
        const current = await getJobById(jobId);
        const updated = await upsertJob({ ...current, progressStep: step });
        emitEvent('job_updated', updated);
      };

      const result = await runSyntheticGenJob(runningJob, updateStatus);

      // Register the resulting dataset
      const datasetName = cfg.name || `synthetic-${jobId}`;
      const jsonlContent = fs.readFileSync(result.finalPath, 'utf8');
      const dataset = await createDatasetFromJsonl(datasetName, jsonlContent);

      const finalJob = await upsertJob({
        ...(await getJobById(jobId)),
        status: 'completed',
        finishedAt: nowIso(),
        artifacts: getArtifacts(outputDir),
        resultDatasetId: dataset.id,
        summaryMetrics: {
          rows: dataset.rows,
        }
      });
      emitEvent('job_updated', finalJob);
    } catch (err) {
      logger.error('Synthetic generation job failed', { jobId, error: err.message });
      const failedJob = await upsertJob({
        ...(await getJobById(jobId)),
        status: 'failed',
        finishedAt: nowIso(),
        error: String(err.message || err),
      });
      emitEvent('job_updated', failedJob);
    }
  })();

  return { ok: true, jobId };
}

module.exports = {
  startFineTuneJob,
  startSyntheticGenJob,
  updateJobMetadata,
  stopJob,
  getJobById,
  getJobLogs,
  getArtifacts,
};