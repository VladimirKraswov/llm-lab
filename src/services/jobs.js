const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config');
const { nowIso, uid } = require('../utils/ids');
const { isPidRunning, killProcessGroup } = require('../utils/proc');
const { getSettings, getDatasets, getJobs, upsertJob, getModelById } = require('./state');
const { emitEvent } = require('./events');
const { readText } = require('../utils/fs');
const { registerLoraFromJob } = require('./loras');
const logger = require('../utils/logger');
const { clearGpuMemory } = require('../utils/gpu');
const { spawnPythonJsonScript } = require('../utils/python-runner');

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

  await clearGpuMemory();

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

  const trainConfig = {
    baseModel: job.baseModel,
    datasetPath: job.datasetPath,
    outputDir: job.outputDir,
    qlora: { ...settings.qlora, ...(job.qlora || {}) },
    wandb: settings.wandb || {},
  };

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

  const runningJob = await upsertJob({
    ...job,
    status: 'running',
    startedAt: nowIso(),
    pid: child.pid,
    configPath,
  });
  emitEvent('job_updated', runningJob);

  child.on('exit', async (code) => {
    logger.info('Fine-tune process exited', {
      jobId,
      code,
      configPath,
    });

    const jobs = await getJobs();
    const current = jobs.find((j) => j.id === jobId);
    if (!current) return;

    const next = await upsertJob({
      ...current,
      status: code === 0 ? 'completed' : 'failed',
      finishedAt: nowIso(),
      error: code === 0 ? null : `trainer exited with code ${code}`,
      pid: null,
      configPath,
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

  const next = await upsertJob({
    ...job,
    status: 'stopped',
    finishedAt: nowIso(),
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

module.exports = {
  startFineTuneJob,
  stopJob,
  getJobById,
  getJobLogs,
};