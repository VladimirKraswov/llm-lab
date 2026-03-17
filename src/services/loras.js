const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { CONFIG } = require('../config');
const { uid, nowIso } = require('../utils/ids');
const {
  getJobs,
  getLoraByJobId,
  addLora,
  getLoraById,
  getModelById,
  upsertLora,
  addModel,
  getModels,
} = require('./state');
const { isPidRunning, killProcessGroup } = require('../utils/proc');
const { emitEvent } = require('./events');
const logger = require('../utils/logger');
const { getDirSize, formatSize, getModelMetadata } = require('../utils/model-meta');
const { spawnPythonJsonScript } = require('../utils/python-runner');
const {
  registerManagedProcess,
  unregisterManagedProcess,
} = require('../utils/managed-processes');
const { clearGpuMemory } = require('../utils/gpu');
const { readText, resetFile } = require('../utils/fs');
const { getGpuInfo } = require('../utils/gpu_info');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeDtype(value) {
  const v = String(value || 'auto').trim().toLowerCase();
  if (['auto', 'float16', 'half', 'fp16', 'bfloat16', 'bf16', 'float32', 'float', 'fp32'].includes(v)) {
    if (v === 'half' || v === 'fp16') return 'float16';
    if (v === 'bf16') return 'bfloat16';
    if (v === 'float' || v === 'fp32') return 'float32';
    return v;
  }
  throw new Error(`Unsupported dtype: ${value}`);
}

function normalizeDeviceStrategy(value) {
  const v = String(value || 'cpu').trim().toLowerCase();
  if (!['cpu', 'cuda', 'auto'].includes(v)) {
    throw new Error(`Unsupported deviceStrategy: ${value}`);
  }
  return v;
}

function normalizeBaseModelSource(value) {
  const v = String(value || 'auto').trim().toLowerCase();
  return v === 'manual' ? 'manual' : 'auto';
}

function readAdapterConfig(adapterPath) {
  try {
    const file = path.join(adapterPath, 'adapter_config.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function resolveTrainingBaseModel(adapterPath) {
  const cfg = readAdapterConfig(adapterPath);
  const value = String(cfg?.base_model_name_or_path || '').trim();
  return value || null;
}

function validateMergeOptions(options = {}) {
  const deviceStrategy = normalizeDeviceStrategy(options.deviceStrategy || 'cpu');
  const dtype = normalizeDtype(options.dtype || 'auto');
  const baseModelSource = normalizeBaseModelSource(options.baseModelSource || 'auto');

  const cudaDevice = options.cudaDevice == null ? 0 : Number(options.cudaDevice);
  if (!Number.isInteger(cudaDevice) || cudaDevice < 0) {
    throw new Error('cudaDevice must be an integer >= 0');
  }

  const maxShardSize = String(options.maxShardSize || '5GB').trim();
  if (!maxShardSize) {
    throw new Error('maxShardSize is required');
  }

  return {
    deviceStrategy,
    cudaDevice,
    dtype,
    lowCpuMemUsage: options.lowCpuMemUsage !== false,
    safeSerialization: options.safeSerialization !== false,
    overwriteOutput: options.overwriteOutput === true,
    maxShardSize,
    offloadFolderName: String(options.offloadFolderName || '_offload').trim() || '_offload',
    clearGpuBeforeMerge: options.clearGpuBeforeMerge === true,
    trustRemoteCode: options.trustRemoteCode === true,
    registerAsModel: options.registerAsModel !== false,
    customOutputName: options.customOutputName ? String(options.customOutputName).trim() : '',
    baseModelSource,
    baseModelOverride: options.baseModelOverride ? String(options.baseModelOverride).trim() : '',
  };
}

function buildMergedPath(item, mergeOptions) {
  const custom = mergeOptions.customOutputName;
  if (custom) {
    const safe = custom.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return path.join(CONFIG.mergedModelsDir, safe || `${item.id}-merged`);
  }
  return path.join(CONFIG.mergedModelsDir, `${item.id}-merged`);
}

function getArtifacts(dirPath) {
  if (!dirPath || !fs.existsSync(dirPath)) return [];
  const names = fs.readdirSync(dirPath);
  return names.map((name) => {
    const full = path.join(dirPath, name);
    const stat = fs.statSync(full);
    return {
      name,
      path: full,
      size: stat.size,
    };
  });
}

async function registerLoraFromJob(jobId, customName = null) {
  const existing = await getLoraByJobId(jobId);
  if (existing) return existing;

  const jobs = await getJobs();
  const job = jobs.find((x) => x.id === jobId);
  if (!job) throw new Error('job not found');
  if (job.status !== 'completed') throw new Error('job is not completed');

  let baseModelName = job.baseModel;
  let baseModelId = job.modelId || null;

  if (baseModelId) {
    const model = await getModelById(baseModelId);
    if (model) baseModelName = model.name;
  }

  const trainingBaseModelPath = resolveTrainingBaseModel(job.outputDir);

  const item = await addLora({
    id: uid('lora'),
    name: (customName || job.name || job.id).trim(),
    jobId: job.id,
    baseModelId,
    baseModelName,
    baseModelRef: job.baseModel,
    adapterPath: job.outputDir,
    mergedPath: null,
    packagePath: null,
    createdAt: nowIso(),
    status: 'ready',
    mergeStatus: 'not_built',
    packageStatus: 'not_built',
    error: null,
    configPath: null,
    mergeLogFile: null,
    mergeOptions: null,
    mergeArtifacts: [],
    trainingBaseModelPath,
  });

  const size = fs.existsSync(item.adapterPath) ? getDirSize(item.adapterPath) : 0;
  const withSize = { ...item, size, sizeHuman: formatSize(size) };

  const final = await upsertLora(withSize);
  emitEvent('lora_created', final);
  logger.info(`LoRA registered from job: ${final.name}`, { loraId: final.id, jobId });
  return final;
}

async function getMergeOptionsInfo() {
  const gpus = await getGpuInfo();
  return {
    deviceStrategies: ['cpu', 'cuda', 'auto'],
    dtypes: ['auto', 'float16', 'bfloat16', 'float32'],
    defaultOptions: {
      deviceStrategy: 'cpu',
      cudaDevice: 0,
      dtype: 'float16',
      lowCpuMemUsage: true,
      safeSerialization: true,
      overwriteOutput: false,
      maxShardSize: '5GB',
      offloadFolderName: '_offload',
      clearGpuBeforeMerge: false,
      trustRemoteCode: false,
      registerAsModel: true,
      baseModelSource: 'auto',
      baseModelOverride: '',
    },
    gpus,
  };
}

async function resolveBaseModelForMerge(item, mergeOptions) {
  if (mergeOptions.baseModelSource === 'manual') {
    const manual = String(mergeOptions.baseModelOverride || '').trim();
    if (!manual) {
      throw new Error('Manual base model is selected, but no baseModelOverride was provided');
    }
    return manual;
  }

  const trainingBase = String(
    item.trainingBaseModelPath ||
    resolveTrainingBaseModel(item.adapterPath) ||
    ''
  ).trim();

  if (trainingBase) {
    return trainingBase;
  }

  const models = await getModels();
  if (item.baseModelId) {
    const model = models.find((m) => m.id === item.baseModelId);
    if (model?.path) return model.path;
  }

  if (item.baseModelRef) {
    return item.baseModelRef;
  }

  throw new Error('Unable to resolve base model for merge');
}

async function buildMergedLora(loraId, options = {}) {
  const item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  if (item.mergeStatus === 'building' && item.mergePid && isPidRunning(item.mergePid)) {
    return item;
  }

  const mergeOptions = validateMergeOptions(options);
  const resolvedBaseModel = await resolveBaseModelForMerge(item, mergeOptions);

  const mergedPath = buildMergedPath(item, mergeOptions);
  const mergeLogFile = path.join(CONFIG.logsDir, `${item.id}-merge.log`);

  fs.mkdirSync(CONFIG.mergedModelsDir, { recursive: true });
  fs.mkdirSync(CONFIG.trainingConfigsDir, { recursive: true });
  fs.mkdirSync(CONFIG.logsDir, { recursive: true });

  if (mergeOptions.clearGpuBeforeMerge && mergeOptions.deviceStrategy !== 'cpu') {
    await clearGpuMemory({ types: ['runtime'] });
  }

  try {
    fs.rmSync(mergeLogFile, { force: true });
  } catch {}

  const next0 = await upsertLora({
    ...item,
    mergeStatus: 'building',
    mergeProgress: 0,
    mergedPath,
    mergePid: null,
    error: null,
    configPath: null,
    mergeLogFile,
    mergeOptions: {
      ...mergeOptions,
      baseModelOverride: mergeOptions.baseModelSource === 'manual' ? resolvedBaseModel : '',
    },
    mergeArtifacts: [],
  });
  emitEvent('lora_updated', next0);

  const scriptPath = path.join(__dirname, '..', 'python', 'merge_lora.py');
  const payload = {
    adapterPath: item.adapterPath,
    outputDir: mergedPath,
    ...mergeOptions,
    baseModelOverride: resolvedBaseModel,
  };

  const outFd = fs.openSync(mergeLogFile, 'w');

  const { child, configPath } = await spawnPythonJsonScript({
    pythonBin: CONFIG.pythonBin,
    scriptPath,
    payload,
    cwd: CONFIG.workspace,
    detached: true,
    stdio: ['ignore', 'pipe', outFd],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    configDir: CONFIG.trainingConfigsDir,
    configPrefix: `merge-${loraId}`,
    logLabel: `merge-lora:${loraId}`,
  });

  child.unref();

  await registerManagedProcess({
    pid: child.pid,
    type: 'lora-merge',
    label: `merge-lora:${loraId}`,
    meta: {
      loraId,
      mergedPath,
      adapterPath: item.adapterPath,
      mergeLogFile,
      mergeOptions,
      resolvedBaseModel,
    },
  });

  const building = await upsertLora({
    ...next0,
    mergePid: child.pid,
    configPath,
  });
  emitEvent('lora_updated', building);

  let stderr = '';

  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.stdout.on('data', async (data) => {
    const text = data.toString();

    resetFile(mergeLogFile);

    const lines = text.split('\n');
    for (const line of lines) {
      if (line.startsWith('__PROGRESS__:')) {
        const p = parseInt(line.split(':')[1], 10);
        const cur = await getLoraById(loraId);
        if (cur) {
          const next = await upsertLora({
            ...cur,
            mergeProgress: Number.isFinite(p) ? p : cur.mergeProgress,
          });
          emitEvent('lora_updated', next);
        }
      }
    }
  });

  child.on('exit', async (code) => {
    await unregisterManagedProcess(child.pid);

    logger.info('LoRA merge process exited', {
      loraId,
      code,
      configPath,
    });

    const current = await getLoraById(loraId);
    if (!current) return;

    const isOk = code === 0;
    const artifacts = isOk ? getArtifacts(mergedPath) : current.mergeArtifacts || [];
    const meta = isOk ? getModelMetadata(mergedPath) : {};

    const next = await upsertLora({
      ...current,
      mergeStatus: isOk ? 'ready' : 'failed',
      mergeProgress: isOk ? 100 : current.mergeProgress,
      mergePid: null,
      mergedPath: isOk ? mergedPath : current.mergedPath,
      error: isOk ? null : (stderr.trim() || `exit code ${code}`),
      configPath,
      mergeArtifacts: artifacts,
      mergedSize: meta.size || 0,
      mergedSizeHuman: meta.sizeHuman || null,
      trainingBaseModelPath: current.trainingBaseModelPath || resolvedBaseModel,
    });
    emitEvent('lora_updated', next);

    if (isOk && mergeOptions.registerAsModel) {
      try {
        const modelId = uid('model');
        await addModel({
          id: modelId,
          name: `Merged: ${current.name}`,
          repoId: `local/${current.id}`,
          createdAt: nowIso(),
          status: 'ready',
          path: mergedPath,
          error: null,
          fromLoraId: loraId,
          configPath,
          ...meta,
        });
        logger.info('Merged model added to library', { modelId, loraId, configPath });
      } catch (err) {
        logger.error('Failed to add merged model to library', {
          error: err.message,
          loraId,
          configPath,
        });
      }
    }

    if (isOk) {
      logger.info(`LoRA merge completed: ${loraId}`, { mergedPath, configPath });
    } else {
      logger.error(`LoRA merge failed: ${loraId}`, {
        error: next.error,
        configPath,
      });
    }
  });

  child.on('error', async (err) => {
    await unregisterManagedProcess(child.pid);

    logger.error('LoRA merge process error', {
      loraId,
      configPath,
      error: String(err.message || err),
    });

    const current = await getLoraById(loraId);
    if (!current) return;

    const next = await upsertLora({
      ...current,
      mergeStatus: 'failed',
      mergePid: null,
      error: String(err.message || err),
      configPath,
    });
    emitEvent('lora_updated', next);
  });

  return building;
}

async function cancelMergedLoraBuild(loraId) {
  const item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  if (!item.mergePid || !isPidRunning(item.mergePid)) {
    throw new Error('merge is not running');
  }

  await killProcessGroup(item.mergePid, 'SIGKILL');
  await unregisterManagedProcess(item.mergePid);

  const next = await upsertLora({
    ...item,
    mergeStatus: 'failed',
    mergePid: null,
    error: 'Merge cancelled by user',
  });

  emitEvent('lora_updated', next);
  return { ok: true, lora: next };
}

async function ensureMergedLora(loraId) {
  let item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  if (item.mergeStatus === 'ready' && item.mergedPath && fs.existsSync(item.mergedPath)) {
    return item;
  }

  if (item.mergeStatus !== 'building' || !item.mergePid || !isPidRunning(item.mergePid)) {
    await buildMergedLora(loraId);
  }

  while (true) {
    await sleep(2000);
    item = await getLoraById(loraId);
    if (item.mergeStatus !== 'building') break;
  }

  if (item.mergeStatus === 'ready') return item;
  throw new Error(item.error || 'LoRA merge failed');
}

async function getMergeLogs(loraId, tail = 200) {
  const item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  const logFile = item.mergeLogFile;
  if (!logFile || !fs.existsSync(logFile)) {
    return {
      id: item.id,
      logFile: null,
      content: '',
    };
  }

  const text = await readText(logFile, '');
  const lines = text.split('\n');

  return {
    id: item.id,
    logFile,
    content: lines.slice(-tail).join('\n'),
  };
}

async function packageMergedLora(loraId) {
  let item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  if (item.mergeStatus !== 'ready') {
    item = await ensureMergedLora(loraId);
  }

  if (item.packageStatus === 'building' && item.packagePid && isPidRunning(item.packagePid)) {
    return item;
  }

  const archivePath = path.join(CONFIG.packagesDir, `${item.id}.tar.gz`);
  fs.mkdirSync(CONFIG.packagesDir, { recursive: true });

  const next0 = await upsertLora({
    ...item,
    packageStatus: 'building',
    packagePath: archivePath,
    packagePid: null,
    error: null,
  });
  emitEvent('lora_updated', next0);

  const child = spawn(
    'tar',
    [
      '-czf',
      archivePath,
      '-C',
      path.dirname(item.mergedPath),
      path.basename(item.mergedPath),
    ],
    {
      cwd: CONFIG.workspace,
      stdio: 'pipe',
    },
  );

  await registerManagedProcess({
    pid: child.pid,
    type: 'lora-package',
    label: `package-lora:${loraId}`,
    meta: {
      loraId,
      mergedPath: item.mergedPath,
      archivePath,
    },
  });

  const building = await upsertLora({
    ...next0,
    packagePid: child.pid,
  });
  emitEvent('lora_updated', building);

  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('exit', async (code) => {
    await unregisterManagedProcess(child.pid);

    logger.info('LoRA package process exited', {
      loraId,
      code,
      archivePath,
    });

    const current = await getLoraById(loraId);
    const next = await upsertLora({
      ...current,
      packageStatus: code === 0 ? 'ready' : 'failed',
      packagePid: null,
      packagePath: code === 0 ? archivePath : current.packagePath,
      error: code === 0 ? null : (stderr.trim() || `exit code ${code}`),
    });
    emitEvent('lora_updated', next);
  });

  child.on('error', async (err) => {
    await unregisterManagedProcess(child.pid);

    const current = await getLoraById(loraId);
    if (!current) return;

    const next = await upsertLora({
      ...current,
      packageStatus: 'failed',
      packagePid: null,
      error: String(err.message || err),
    });
    emitEvent('lora_updated', next);
  });

  return building;
}

module.exports = {
  registerLoraFromJob,
  buildMergedLora,
  ensureMergedLora,
  packageMergedLora,
  getMergeOptionsInfo,
  getMergeLogs,
  cancelMergedLoraBuild,
  validateMergeOptions,
};