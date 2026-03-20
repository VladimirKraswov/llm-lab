const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { CONFIG } = require('../config');
const { nowIso, uid } = require('../utils/ids');
const { isPidRunning, killProcessGroup } = require('../utils/proc');
const { getSettings, getDatasets, getModelById } = require('./state');
const { emitEvent } = require('./events');
const { readText } = require('../utils/fs');
const { registerLoraFromJob } = require('./loras');
const { runSyntheticGenJob } = require('./synthetic');
const {
  importSyntheticDatasetFromJsonlFile,
} = require('./synthetic-datasets');
const logger = require('../utils/logger');
const { clearGpuMemory } = require('../utils/gpu');
const { spawnPythonJsonScript } = require('../utils/python-runner');
const { getModelMetadata } = require('../utils/model-meta');
const {
  registerManagedProcess,
  unregisterManagedProcess,
} = require('../utils/managed-processes');
const { db } = require('../db');
const { generateCallbackToken } = require('./auth');

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
  if (params.num_train_epochs !== undefined && (!Number.isInteger(params.num_train_epochs) || params.num_train_epochs < 1)) {
    throw new Error('num_train_epochs must be an integer >= 1');
  }
  if (params.per_device_train_batch_size !== undefined && (!Number.isInteger(params.per_device_train_batch_size) || params.per_device_train_batch_size < 1)) {
    throw new Error('per_device_train_batch_size must be an integer >= 1');
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

async function getAllJobs(limit = 50, offset = 0) {
  const jobs = await db('jobs')
    .select('*')
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);
  return jobs.map(parseJob);
}

function parseJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    name: job.name,
    type: job.type,
    mode: job.mode,
    status: job.status,
    currentStage: job.current_stage,
    progressPercent: job.progress_percent,
    message: job.message,
    workerType: job.worker_type,
    launchMode: job.launch_mode,
    workerHost: job.worker_host,
    workerId: job.worker_id,
    containerImage: job.container_image,
    containerCommand: job.container_command,
    jobConfigUrl: job.job_config_url,
    lastStatusPayload: job.last_status_payload ? JSON.parse(job.last_status_payload) : null,
    lastProgressPayload: job.last_progress_payload ? JSON.parse(job.last_progress_payload) : null,
    finalPayload: job.final_payload ? JSON.parse(job.final_payload) : null,
    logFile: job.log_file,
    logChunkCount: job.log_chunk_count,
    lastLogOffset: job.last_log_offset,
    hfRepoIdLora: job.hf_repo_id_lora,
    hfRepoIdMerged: job.hf_repo_id_merged,
    hfRepoIdMetadata: job.hf_repo_id_metadata,
    publishedAt: job.published_at,
    error: job.error,
    tags: job.tags ? JSON.parse(job.tags) : [],
    notes: job.notes,
    paramsSnapshot: job.params_snapshot ? JSON.parse(job.params_snapshot) : null,
    datasetSnapshot: job.dataset_snapshot ? JSON.parse(job.dataset_snapshot) : null,
    modelSnapshot: job.model_snapshot ? JSON.parse(job.model_snapshot) : null,
    envSnapshot: job.env_snapshot ? JSON.parse(job.env_snapshot) : null,
    summaryMetrics: job.summary_metrics ? JSON.parse(job.summary_metrics) : {},
    datasetId: job.dataset_id,
    modelId: job.model_id,
    baseModel: job.base_model,
    outputDir: job.output_dir,
    pid: job.pid,
    configPath: job.config_path,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
  };
}

async function upsertJob(job) {
  const existing = await db('jobs').where({ id: job.id }).first();
  const dbJob = {
    id: job.id,
    name: job.name,
    type: job.type,
    mode: job.mode || 'local',
    status: job.status,
    current_stage: job.currentStage || null,
    progress_percent: job.progressPercent || 0,
    message: job.message || null,
    worker_type: job.workerType || null,
    launch_mode: job.launchMode || null,
    worker_host: job.workerHost || null,
    worker_id: job.workerId || null,
    container_image: job.containerImage || null,
    container_command: job.containerCommand || null,
    job_config_url: job.jobConfigUrl || null,
    last_status_payload: job.lastStatusPayload ? JSON.stringify(job.lastStatusPayload) : null,
    last_progress_payload: job.lastProgressPayload ? JSON.stringify(job.lastProgressPayload) : null,
    final_payload: job.finalPayload ? JSON.stringify(job.finalPayload) : null,
    log_file: job.logFile || null,
    log_chunk_count: job.logChunkCount || 0,
    last_log_offset: job.lastLogOffset || 0,
    hf_repo_id_lora: job.hfRepoIdLora || null,
    hf_repo_id_merged: job.hfRepoIdMerged || null,
    hf_repo_id_metadata: job.hfRepoIdMetadata || null,
    published_at: job.publishedAt || null,
    error: job.error || null,
    tags: JSON.stringify(job.tags || []),
    notes: job.notes || '',
    params_snapshot: job.paramsSnapshot ? JSON.stringify(job.paramsSnapshot) : null,
    dataset_snapshot: job.datasetSnapshot ? JSON.stringify(job.datasetSnapshot) : null,
    model_snapshot: job.modelSnapshot ? JSON.stringify(job.modelSnapshot) : null,
    env_snapshot: job.envSnapshot ? JSON.stringify(job.envSnapshot) : null,
    summary_metrics: job.summaryMetrics ? JSON.stringify(job.summaryMetrics) : null,
    dataset_id: job.datasetId || job.dataset_id || null,
    model_id: job.modelId || job.model_id || null,
    base_model: job.baseModel || job.base_model || null,
    output_dir: job.outputDir || job.output_dir || null,
    pid: job.pid || null,
    config_path: job.configPath || job.config_path || null,
    started_at: job.startedAt || job.started_at || null,
    finished_at: job.finishedAt || job.finished_at || null,
    updated_at: nowIso(),
  };

  if (existing) {
    await db('jobs').where({ id: job.id }).update(dbJob);
  } else {
    dbJob.created_at = job.createdAt || nowIso();
    await db('jobs').insert(dbJob);
  }
  return getJobById(job.id);
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
    mode: 'local',
    name: name || jobId,
    status: 'queued',
    datasetId,
    modelId: selectedModelId,
    baseModel: selectedBaseModel,
    outputDir,
    logFile,
    paramsSnapshot: trainConfig,
    datasetSnapshot,
    modelSnapshot: {
      path: selectedBaseModel,
      ...getModelMetadata(selectedBaseModel),
    },
    envSnapshot,
    tags: [],
    notes: '',
  };

  await upsertJob(job);
  emitEvent('job_updated', job);
  logger.info(`Starting local fine-tune job: ${job.name}`, {
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
    const current = await getJobById(jobId);
    if (!current) return;

    const patch = {
      status: code === 0 ? 'completed' : 'failed',
      finishedAt: nowIso(),
      error: code === 0 ? null : `trainer exited with code ${code}`,
      pid: null,
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
      // Register artifacts
      const artifacts = getArtifacts(current.outputDir);
      for (const art of artifacts) {
        await db('job_artifacts').insert({
          job_id: jobId,
          name: art.name,
          path: art.path,
          size: art.size,
        });
      }
    }

    const next = await upsertJob({ ...current, ...patch });
    emitEvent('job_updated', next);

    if (code === 0 && current.paramsSnapshot?.qlora?.useLora !== false) {
      try {
        await registerLoraFromJob(jobId);
      } catch (err) {
        logger.error('LoRA auto-registration failed', { jobId, error: err.message });
      }
    }
  });

  return { ok: true, jobId };
}

async function createRemoteJob(payload) {
  const { name, type, datasetId, modelId, baseModel, qlora, hfPublish, workerId } = payload;
  const jobId = uid('job');

  const settings = await getSettings();

  // For remote jobs, we use the baked-in model path by default
  const selectedBaseModel = baseModel || CONFIG.remoteBakedModelPath;

  const job = {
    id: jobId,
    name: name || jobId,
    type: type || 'remote-train',
    mode: 'remote',
    status: 'queued',
    datasetId,
    modelId: modelId || null,
    baseModel: selectedBaseModel,
    workerId: workerId || null,
    paramsSnapshot: {
      baseModel: selectedBaseModel,
      modelSource: 'local',
      qlora: { ...settings.qlora, ...(qlora || {}) },
      hfPublish: hfPublish || { enabled: false },
    },
    tags: payload.tags || [],
    notes: payload.notes || '',
    jobConfigUrl: `${CONFIG.callbackBaseUrl}/api/jobs/${jobId}/config`,
  };

  const dbJob = await upsertJob(job);
  await generateCallbackToken(jobId);

  emitEvent('job_updated', dbJob);
  return dbJob;
}

async function cloneJob(jobId) {
  const source = await getJobById(jobId);
  if (!source) throw new Error('Source job not found');

  return createRemoteJob({
    name: `${source.name} (cloned)`,
    type: source.type,
    datasetId: source.datasetId,
    modelId: source.modelId,
    baseModel: source.baseModel,
    qlora: source.paramsSnapshot?.qlora,
    hfPublish: source.paramsSnapshot?.hfPublish,
    tags: source.tags,
    notes: source.notes,
  });
}

async function retryJob(jobId) {
  const source = await getJobById(jobId);
  if (!source) throw new Error('Job not found');
  if (source.status !== 'failed' && source.status !== 'stopped') {
    throw new Error('Can only retry failed or stopped jobs');
  }

  const job = {
    ...source,
    id: uid('job'),
    name: `${source.name} (retry)`,
    status: 'queued',
    startedAt: null,
    finishedAt: null,
    error: null,
    progressPercent: 0,
    currentStage: 'queued',
    createdAt: nowIso(),
    jobConfigUrl: source.mode === 'remote' ? `${CONFIG.callbackBaseUrl}/api/jobs/${source.id}/config` : null,
  };

  const dbJob = await upsertJob(job);
  if (source.mode === 'remote') {
    await generateCallbackToken(job.id);
  } else if (source.type === 'fine-tune') {
    return startFineTuneJob({
      datasetId: source.datasetId,
      name: job.name,
      modelId: source.modelId,
      baseModel: source.baseModel,
      qlora: source.paramsSnapshot?.qlora,
    });
  }

  emitEvent('job_updated', dbJob);
  return dbJob;
}

async function cancelJob(jobId) {
  return stopJob(jobId);
}

async function handleWorkerStatus(jobId, payload) {
  const job = await getJobById(jobId);
  if (!job) throw new Error('Job not found');

  const patch = {
    status: payload.status,
    currentStage: payload.stage,
    message: payload.message,
    lastStatusPayload: payload,
  };

  if (payload.status === 'running' && !job.startedAt) {
    patch.startedAt = nowIso();
  }
  if (['completed', 'failed', 'stopped'].includes(payload.status)) {
    patch.finishedAt = nowIso();
  }
  if (payload.error) {
    patch.error = payload.error;
  }

  const updated = await upsertJob({ ...job, ...patch });
  emitEvent('job_updated', updated);

  await db('job_events').insert({
    job_id: jobId,
    type: 'status_change',
    payload: JSON.stringify(payload),
  });

  return { ok: true };
}

async function handleWorkerProgress(jobId, payload) {
  const job = await getJobById(jobId);
  const updated = await upsertJob({
    ...job,
    progressPercent: payload.progress || 0,
    currentStage: payload.stage || job.currentStage,
    lastProgressPayload: payload,
  });

  emitEvent('job_progress', { jobId, ...payload });
  return { ok: true };
}

async function handleWorkerLogs(jobId, payload) {
  const { logs, offset } = payload;

  await db('job_logs').insert({
    job_id: jobId,
    content: logs,
    offset: offset,
  });

  emitEvent('job_log_chunk', { jobId, logs, offset });
  return { ok: true };
}

async function handleWorkerFinal(jobId, payload) {
  const job = await getJobById(jobId);
  const patch = {
    status: 'completed',
    finishedAt: nowIso(),
    finalPayload: payload,
    summaryMetrics: payload.metrics || {},
    hfRepoIdLora: payload.hf_repo_id_lora,
    hfRepoIdMerged: payload.hf_repo_id_merged,
    hfRepoIdMetadata: payload.hf_repo_id_metadata,
    publishedAt: payload.published_at || nowIso(),
  };

  const updated = await upsertJob({ ...job, ...patch });

  if (payload.artifacts) {
    for (const art of payload.artifacts) {
      await db('job_artifacts').insert({
        job_id: jobId,
        name: art.name,
        type: art.type,
        url: art.url,
        size: art.size,
      });
    }
  }

  emitEvent('job_finalized', updated);
  return { ok: true };
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
  const job = await getJobById(jobId);

  if (job.mode === 'remote') {
    const updated = await upsertJob({ ...job, status: 'stopped', finishedAt: nowIso() });
    emitEvent('job_updated', updated);
    return { ok: true, message: 'Stop signal sent to remote worker' };
  }

  if (!job.pid || !isPidRunning(job.pid)) {
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
  return { ok: true };
}

async function getJobById(id) {
  const job = await db('jobs').where({ id }).first();
  if (!job) return null;
  return parseJob(job);
}

async function getJobEvents(id) {
  const events = await db('job_events')
    .where({ job_id: id })
    .orderBy('created_at', 'asc');
  return events.map(e => ({
    ...e,
    payload: e.payload ? JSON.parse(e.payload) : null
  }));
}

async function getJobLogs(id, tail = 200) {
  const job = await getJobById(id);
  if (job.mode === 'local') {
    const text = await readText(job.logFile, '');
    const lines = text.split('\n');
    return {
      id: job.id,
      logFile: job.logFile,
      content: lines.slice(-tail).join('\n'),
    };
  } else {
    const logs = await db('job_logs')
      .where({ job_id: id })
      .orderBy('created_at', 'desc')
      .limit(tail);
    return {
      id: job.id,
      content: logs.reverse().map(l => l.content).join('\n'),
    };
  }
}

async function getJobLaunchCommand(id) {
  const job = await getJobById(id);
  if (!job) throw new Error('Job not found');

  const hfToken = '${HF_TOKEN}';
  const configUrl = job.jobConfigUrl;

  return `docker run --runtime=nvidia --gpus all \\
  -e JOB_CONFIG_URL=${configUrl} \\
  -e HF_TOKEN=${hfToken} \\
  trainer-container-image`;
}

async function startSyntheticGenJob(cfg) {
  const jobId = uid('job');
  const outputDir = path.join(CONFIG.syntheticDir, jobId);
  const logFile = path.join(CONFIG.logsDir, `${jobId}.log`);

  const job = {
    id: jobId,
    type: 'synthetic-gen',
    mode: 'local',
    name: cfg.name || jobId,
    status: 'queued',
    paramsSnapshot: cfg,
    outputDir,
    logFile,
    tags: [],
    notes: '',
  };

  await upsertJob(job);
  emitEvent('job_updated', job);

  (async () => {
    try {
      await upsertJob({ ...job, status: 'running', startedAt: nowIso() });
      emitEvent('job_updated', await getJobById(jobId));

      const result = await runSyntheticGenJob(job, async (step) => {
        await db('jobs').where({ id: jobId }).update({ current_stage: step });
        emitEvent('job_updated', await getJobById(jobId));
      });

      const { dataset, importMeta } = await importSyntheticDatasetFromJsonlFile(
        cfg.name || `synthetic-${jobId}`,
        result.finalPath,
        { sourcePath: result.finalPath }
      );

      await upsertJob({
        ...(await getJobById(jobId)),
        status: 'completed',
        finishedAt: nowIso(),
        summaryMetrics: {
          rows: dataset.rows,
          validCount: importMeta.validCount,
          invalidCount: importMeta.invalidCount,
        },
      });

      emitEvent('job_updated', await getJobById(jobId));
    } catch (err) {
      logger.error('Synthetic generation job failed', { jobId, error: err.message });
      await upsertJob({
        ...(await getJobById(jobId)),
        status: 'failed',
        finishedAt: nowIso(),
        error: String(err.message || err),
      });
      emitEvent('job_updated', await getJobById(jobId));
    }
  })();

  return { ok: true, jobId };
}

module.exports = {
  getAllJobs,
  startFineTuneJob,
  createRemoteJob,
  cloneJob,
  retryJob,
  cancelJob,
  handleWorkerStatus,
  handleWorkerProgress,
  handleWorkerFinal,
  handleWorkerLogs,
  startSyntheticGenJob,
  updateJobMetadata,
  stopJob,
  getJobById,
  getJobEvents,
  getJobLogs,
  getJobLaunchCommand,
  getArtifacts,
  parseJob,
  upsertJob,
};
