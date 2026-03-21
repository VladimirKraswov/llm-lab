const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');

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
const { getRuntimePresetById } = require('./runtime-presets');

function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  if (typeof value !== 'string') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeJobStatus(value, fallback = 'running') {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;

  if (raw === 'success') return 'finished';
  if (raw === 'completed') return 'finished';
  if (raw === 'error') return 'failed';

  return raw;
}

function isTerminalJobStatus(value) {
  const normalized = normalizeJobStatus(value, '');
  return ['finished', 'completed', 'failed', 'stopped'].includes(normalized);
}

function buildApiUrl(base, apiPath) {
  const root = String(base || '').replace(/\/+$/, '');
  if (!root) {
    throw new Error('CALLBACK_BASE_URL is empty');
  }

  return root.endsWith('/api')
    ? `${root}${apiPath.replace(/^\/api/, '')}`
    : `${root}${apiPath}`;
}

async function getOrCreateActiveCallbackToken(jobId) {
  let tokenRecord = await db('job_callback_tokens')
    .where({ job_id: jobId, is_active: true })
    .orderBy('created_at', 'desc')
    .first();

  if (!tokenRecord) {
    const token = await generateCallbackToken(jobId);
    tokenRecord = { id: token };
  }

  return tokenRecord.id;
}

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
    const output = await new Promise((resolve, reject) => {
      exec(
        `${CONFIG.pythonBin} -c '${code.replace(/'/g, "'\\''")}'`,
        { timeout: 10000 },
        (error, stdout) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(stdout);
        }
      );
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
    if (!fs.existsSync(filePath)) {
      return { path: filePath, size: 0, mtime: null, hash: null };
    }

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
  } catch {
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
  } catch {
    return [];
  }
}

function validateQLoraParams(params) {
  if (
    params.learningRate !== undefined &&
    (typeof params.learningRate !== 'number' || params.learningRate <= 0)
  ) {
    throw new Error('learningRate must be a positive number');
  }
  if (
    params.numTrainEpochs !== undefined &&
    (!Number.isInteger(params.numTrainEpochs) || params.numTrainEpochs < 1)
  ) {
    throw new Error('numTrainEpochs must be an integer >= 1');
  }
  if (
    params.perDeviceTrainBatchSize !== undefined &&
    (!Number.isInteger(params.perDeviceTrainBatchSize) || params.perDeviceTrainBatchSize < 1)
  ) {
    throw new Error('perDeviceTrainBatchSize must be an integer >= 1');
  }
  if (
    params.gradientAccumulationSteps !== undefined &&
    (!Number.isInteger(params.gradientAccumulationSteps) || params.gradientAccumulationSteps < 1)
  ) {
    throw new Error('gradientAccumulationSteps must be an integer >= 1');
  }
  if (
    params.num_train_epochs !== undefined &&
    (!Number.isInteger(params.num_train_epochs) || params.num_train_epochs < 1)
  ) {
    throw new Error('num_train_epochs must be an integer >= 1');
  }
  if (
    params.per_device_train_batch_size !== undefined &&
    (!Number.isInteger(params.per_device_train_batch_size) || params.per_device_train_batch_size < 1)
  ) {
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
    runtimePresetId: job.runtime_preset_id,
    modelLocalPath: job.model_local_path,
    containerImage: job.container_image,
    containerCommand: job.container_command,
    jobConfigUrl: job.job_config_url,
    lastStatusPayload: safeJsonParse(job.last_status_payload, null),
    lastProgressPayload: safeJsonParse(job.last_progress_payload, null),
    finalPayload: safeJsonParse(job.final_payload, null),
    logFile: job.log_file,
    logChunkCount: job.log_chunk_count,
    lastLogOffset: job.last_log_offset,
    hfRepoIdLora: job.hf_repo_id_lora,
    hfRepoIdMerged: job.hf_repo_id_merged,
    hfRepoIdMetadata: job.hf_repo_id_metadata,
    publishedAt: job.published_at,
    error: job.error,
    tags: safeJsonParse(job.tags, []),
    notes: job.notes,
    paramsSnapshot: safeJsonParse(job.params_snapshot, null),
    datasetSnapshot: safeJsonParse(job.dataset_snapshot, null),
    modelSnapshot: safeJsonParse(job.model_snapshot, null),
    envSnapshot: safeJsonParse(job.env_snapshot, null),
    summaryMetrics: safeJsonParse(job.summary_metrics, {}),
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
    progress_percent: job.progressPercent ?? 0,
    message: job.message || null,
    worker_type: job.workerType || null,
    launch_mode: job.launchMode || null,
    worker_host: job.workerHost || null,
    worker_id: job.workerId || null,
    runtime_preset_id: job.runtimePresetId || null,
    model_local_path: job.modelLocalPath || null,
    container_image: job.containerImage || null,
    container_command: job.containerCommand || null,
    job_config_url: job.jobConfigUrl || null,
    last_status_payload: job.lastStatusPayload ? JSON.stringify(job.lastStatusPayload) : null,
    last_progress_payload: job.lastProgressPayload ? JSON.stringify(job.lastProgressPayload) : null,
    final_payload: job.finalPayload ? JSON.stringify(job.finalPayload) : null,
    log_file: job.logFile || null,
    log_chunk_count: job.logChunkCount ?? 0,
    last_log_offset: job.lastLogOffset ?? 0,
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

/** @deprecated Direct backend execution is no longer recommended. Use agent-based flow. */
async function startFineTuneJob(payload) {
  return createRemoteJob({
    ...payload,
    type: 'fine-tune',
  });
}

async function createRemoteJob(payload, options = {}) {
  const {
    name,
    type,
    datasetId,
    baseModel,
    qlora,
    workerId,
    runtimePresetId,
    hfPublish,
    pipeline,
    trainerImage,
    tags,
    notes,
  } = payload;

  if (!datasetId) {
    throw new Error('datasetId is required');
  }

  if (qlora) {
    validateQLoraParams(qlora);
  }

  const settings = await getSettings();
  const datasets = await getDatasets();
  const ds = datasets.find((x) => x.id === datasetId);

  if (!ds) {
    throw new Error('dataset not found');
  }

  const callbackBase = String(options.publicBaseUrl || CONFIG.callbackBaseUrl || '').trim();
  if (!callbackBase) {
    throw new Error('Public callback base URL is empty');
  }

  const jobId = uid('job');
  const jobName = String(name || jobId).trim();

  const preset = runtimePresetId ? await getRuntimePresetById(runtimePresetId) : null;

  const selectedBaseModel = String(
    baseModel || (preset ? preset.logicalBaseModelId : settings.baseModel) || CONFIG.defaultBaseModel
  ).trim();

  if (!selectedBaseModel) {
    throw new Error('baseModel is required');
  }

  const effectiveQlora = { ...settings.qlora, ...(qlora || {}) };
  const effectiveHfPublish = hfPublish || {};
  const effectiveTrainerImage =
    trainerImage || (preset ? preset.trainerImage : 'itk-ai-trainer-service:qwen-7b');
  const effectiveModelLocalPath = preset ? preset.localModelPath : '/app';

  const baseJobConfigUrl = buildApiUrl(callbackBase, `/api/jobs/${jobId}/config`);

  const initialJob = {
    id: jobId,
    name: jobName,
    type: type || 'remote-train',
    mode: 'remote',
    status: 'queued',
    currentStage: 'queued',
    progressPercent: 0,
    workerType: 'trainer-service',
    launchMode: 'manual',
    datasetId,
    modelId: null,
    baseModel: selectedBaseModel,
    workerId: workerId || null,
    runtimePresetId: runtimePresetId || null,
    modelLocalPath: effectiveModelLocalPath,
    containerImage: effectiveTrainerImage,
    paramsSnapshot: {
      qlora: effectiveQlora,
      hfPublish: effectiveHfPublish,
      pipeline: pipeline || null,
    },
    tags: tags || [],
    notes: notes || '',
    jobConfigUrl: baseJobConfigUrl,
    hfRepoIdLora: effectiveHfPublish.repo_id_lora || null,
    hfRepoIdMerged: effectiveHfPublish.repo_id_merged || null,
    hfRepoIdMetadata: effectiveHfPublish.repo_id_metadata || null,
  };

  const savedJob = await upsertJob(initialJob);
  const callbackToken = await getOrCreateActiveCallbackToken(jobId);
  const launchJobConfigUrl = `${baseJobConfigUrl}?token=${encodeURIComponent(callbackToken)}`;

  return {
    ...savedJob,
    launch: {
      jobConfigUrl: launchJobConfigUrl,
      env: {
        JOB_CONFIG_URL: launchJobConfigUrl,
      },
      exampleDockerRun: [
        'docker run --rm --gpus all \\',
        '  --shm-size 16g \\',
        `  -e JOB_CONFIG_URL="${launchJobConfigUrl}" \\`,
        '  -e HF_TOKEN="$HF_TOKEN" \\',
        `  ${effectiveTrainerImage}`,
      ].join('\n'),
    },
  };
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
    pipeline: source.paramsSnapshot?.pipeline,
    runtimePresetId: source.runtimePresetId,
    trainerImage: source.containerImage,
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

  if (source.mode === 'remote') {
    return createRemoteJob({
      name: `${source.name} (retry)`,
      type: source.type,
      datasetId: source.datasetId,
      modelId: source.modelId,
      baseModel: source.baseModel,
      qlora: source.paramsSnapshot?.qlora,
      hfPublish: source.paramsSnapshot?.hfPublish,
      pipeline: source.paramsSnapshot?.pipeline,
      runtimePresetId: source.runtimePresetId,
      trainerImage: source.containerImage,
      tags: source.tags,
      notes: source.notes,
      workerId: source.workerId,
    });
  }

  const retried = await upsertJob({
    ...source,
    id: uid('job'),
    name: `${source.name} (retry)`,
    status: 'queued',
    currentStage: 'queued',
    progressPercent: 0,
    startedAt: null,
    finishedAt: null,
    error: null,
    createdAt: nowIso(),
  });

  emitEvent('job_updated', retried);
  return retried;
}

async function cancelJob(jobId) {
  return stopJob(jobId);
}

async function handleWorkerStatus(jobId, payload) {
  const job = await getJobById(jobId);
  if (!job) throw new Error('Job not found');

  const normalizedStatus = normalizeJobStatus(payload.status, job.status || 'running');

  const patch = {
    status: normalizedStatus || job.status,
    currentStage: payload.stage || job.currentStage,
    message: payload.message || job.message,
    progressPercent:
      payload.progress !== undefined && payload.progress !== null
        ? Number(payload.progress)
        : job.progressPercent,
    lastStatusPayload: payload,
  };

  if ((normalizedStatus === 'started' || normalizedStatus === 'running') && !job.startedAt) {
    patch.startedAt = nowIso();
  }

  if (isTerminalJobStatus(normalizedStatus)) {
    patch.finishedAt = nowIso();
  }

  if (payload.error) {
    patch.error = payload.error;
  }

  const updated = await upsertJob({ ...job, ...patch });
  emitEvent('job_updated', updated);

  await db('job_events').insert({
    job_id: jobId,
    type: 'status',
    payload: JSON.stringify(payload),
  });

  return { ok: true };
}

async function handleWorkerProgress(jobId, payload) {
  const job = await getJobById(jobId);
  if (!job) throw new Error('Job not found');

  const fallbackStatus =
    ['queued', 'assigned'].includes(String(job.status || '').toLowerCase())
      ? 'running'
      : job.status;

  const normalizedStatus = normalizeJobStatus(payload.status, fallbackStatus);

  const updated = await upsertJob({
    ...job,
    status: normalizedStatus,
    progressPercent:
      payload.progress !== undefined && payload.progress !== null
        ? Number(payload.progress)
        : job.progressPercent,
    currentStage: payload.stage || job.currentStage,
    message: payload.message || job.message,
    lastProgressPayload: payload,
    startedAt: job.startedAt || nowIso(),
  });

  await db('job_events').insert({
    job_id: jobId,
    type: 'progress',
    payload: JSON.stringify(payload),
  });

  emitEvent('job_progress', { jobId, ...payload });
  emitEvent('job_updated', updated);

  return { ok: true };
}

async function handleWorkerLogs(jobId, payload) {
  const job = await getJobById(jobId);
  if (!job) throw new Error('Job not found');

  const content = String(payload.logs ?? payload.chunk ?? '');
  const offset = Number(payload.offset || 0);

  if (!content) {
    return { ok: true };
  }

  await db('job_logs').insert({
    job_id: jobId,
    content,
    offset,
  });

  const nextOffset = offset + Buffer.byteLength(content, 'utf8');

  await upsertJob({
    ...job,
    logChunkCount: Number(job.logChunkCount || 0) + 1,
    lastLogOffset: nextOffset,
  });

  emitEvent('job_log_chunk', { jobId, logs: content, offset });
  return { ok: true };
}

async function handleWorkerFinal(jobId, payload) {
  const job = await getJobById(jobId);
  if (!job) throw new Error('Job not found');

  const result = payload.result || {};
  const failed =
    normalizeJobStatus(payload.status, '') === 'failed' ||
    normalizeJobStatus(result.status, '') === 'failed';

  const finalStatus = failed
    ? 'failed'
    : normalizeJobStatus(payload.status || result.status || 'finished', 'finished');

  const patch = {
    status: finalStatus,
    currentStage: failed ? 'failed' : (payload.stage || 'finished'),
    progressPercent: 100,
    finishedAt: nowIso(),
    finalPayload: payload,
    summaryMetrics: {
      training: result.training?.summary || null,
      evaluation: result.evaluation?.summary || null,
    },
    hfRepoIdLora: result?.uploads?.hf_lora?.repo_id || job.hfRepoIdLora || null,
    hfRepoIdMerged: result?.uploads?.hf_merged?.repo_id || job.hfRepoIdMerged || null,
    hfRepoIdMetadata: result?.uploads?.hf_metadata?.repo_id || job.hfRepoIdMetadata || null,
    error: failed ? (result.error || payload.error || 'remote job failed') : null,
  };

  const updated = await upsertJob({ ...job, ...patch });

  await db('job_events').insert({
    job_id: jobId,
    type: 'final',
    payload: JSON.stringify(payload),
  });

  emitEvent('job_finalized', updated);
  emitEvent('job_updated', updated);

  return { ok: true };
}

async function updateJobMetadata(jobId, { tags, notes }) {
  const current = await getJobById(jobId);
  if (!current) throw new Error('Job not found');

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
  if (!job) throw new Error('Job not found');

  if (job.mode === 'remote') {
    const updated = await upsertJob({
      ...job,
      status: 'stopped',
      currentStage: 'stopped',
      finishedAt: nowIso(),
    });
    emitEvent('job_updated', updated);
    return { ok: true, message: 'Remote job marked as stopped' };
  }

  if (!job.pid || !isPidRunning(job.pid)) {
    throw new Error('job is not running');
  }

  await killProcessGroup(job.pid);
  await unregisterManagedProcess(job.pid);

  const next = await upsertJob({
    ...job,
    status: 'stopped',
    currentStage: 'stopped',
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

  return events.map((event) => ({
    ...event,
    payload: safeJsonParse(event.payload, null),
  }));
}

async function getJobLogs(id, tail = 200) {
  const job = await getJobById(id);
  if (!job) throw new Error('Job not found');

  if (job.mode === 'local') {
    const text = await readText(job.logFile, '');
    const lines = text.split('\n');
    return {
      id: job.id,
      logFile: job.logFile,
      content: lines.slice(-tail).join('\n'),
    };
  }

  const logs = await db('job_logs')
    .where({ job_id: id })
    .orderBy('offset', 'desc')
    .limit(tail);

  const dbContent = logs.reverse().map((entry) => entry.content).join('');

  if (dbContent) {
    return {
      id: job.id,
      content: dbContent,
    };
  }

  const fallback = [
    job.lastStatusPayload?.logs || '',
    job.lastProgressPayload?.logs || '',
    job.finalPayload?.result?.logs || '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  return {
    id: job.id,
    content: fallback,
  };
}

async function getJobLaunchCommand(id) {
  const job = await getJobById(id);
  if (!job) throw new Error('Job not found');

  if (job.mode !== 'remote') {
    return 'Local jobs are started by the backend directly';
  }

  const callbackToken = await getOrCreateActiveCallbackToken(job.id);
  const baseUrl = String(job.jobConfigUrl || '').trim();
  const jobConfigUrl = baseUrl.includes('?token=')
    ? baseUrl
    : `${baseUrl}?token=${encodeURIComponent(callbackToken)}`;

  const image = job.containerImage || 'itk-ai-trainer-service:qwen-7b';
  const hfToken = '${HF_TOKEN}';

  return [
    'docker run --rm --gpus all \\',
    '  --shm-size 16g \\',
    `  -e JOB_CONFIG_URL="${jobConfigUrl}" \\`,
    `  -e HF_TOKEN="${hfToken}" \\`,
    `  ${image}`,
  ].join('\n');
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
