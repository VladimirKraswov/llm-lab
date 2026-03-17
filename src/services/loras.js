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
  getLoras,
} = require('./state');
const { isPidRunning } = require('../utils/proc');
const { emitEvent } = require('./events');
const logger = require('../utils/logger');
const { getDirSize, formatSize, getModelMetadata } = require('../utils/model-meta');
const { spawnPythonJsonScript } = require('../utils/python-runner');
const {
  registerManagedProcess,
  unregisterManagedProcess,
} = require('../utils/managed-processes');
const { clearGpuMemory } = require('../utils/gpu');

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
  });

  const size = fs.existsSync(item.adapterPath) ? getDirSize(item.adapterPath) : 0;
  const withSize = { ...item, size, sizeHuman: formatSize(size) };

  const final = await upsertLora(withSize);
  emitEvent('lora_created', final);
  logger.info(`LoRA registered from job: ${final.name}`, { loraId: final.id, jobId });
  return final;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMergedPath(item, mergeOptions = {}) {
  const customOutputName = String(mergeOptions.customOutputName || '').trim();
  if (customOutputName) {
    return path.join(CONFIG.mergedModelsDir, customOutputName);
  }
  return path.join(CONFIG.mergedModelsDir, `${item.id}-merged`);
}

function getMergeArtifacts(mergedPath) {
  try {
    if (!mergedPath || !fs.existsSync(mergedPath)) return [];
    return fs.readdirSync(mergedPath).map((name) => {
      const filePath = path.join(mergedPath, name);
      const stats = fs.statSync(filePath);
      return {
        name,
        path: filePath,
        size: stats.size,
      };
    });
  } catch {
    return [];
  }
}

async function resolveBaseModelForMerge(item, mergeOptions = {}) {
  if (mergeOptions.baseModelSource === 'manual') {
    const manual = String(mergeOptions.baseModelOverride || '').trim();
    if (!manual) {
      throw new Error('baseModelOverride is required when baseModelSource=manual');
    }
    return manual;
  }

  if (item.baseModelId) {
    const model = await getModelById(item.baseModelId);
    if (model?.path) return model.path;
  }

  if (item.baseModelRef) return item.baseModelRef;

  throw new Error('Unable to resolve base model for merge');
}

async function finalizeMergeSuccess(loraId, mergedPath, configPath, mergeLogFile) {
  const current = await getLoraById(loraId);
  if (!current) return null;

  const artifacts = getMergeArtifacts(mergedPath);
  const size = fs.existsSync(mergedPath) ? getDirSize(mergedPath) : 0;

  const next = await upsertLora({
    ...current,
    mergeStatus: 'ready',
    mergeProgress: 100,
    mergePid: null,
    mergedPath,
    error: null,
    configPath,
    mergeLogFile,
    mergeArtifacts: artifacts,
  });

  emitEvent('lora_updated', next);

  const alreadyRegistered = current.mergedModelId
    ? await getModelById(current.mergedModelId)
    : null;

  if (!alreadyRegistered) {
    try {
      const modelId = uid('model');
      const modelMeta = getModelMetadata(mergedPath);

      await addModel({
        id: modelId,
        name: `Merged: ${current.name}`,
        repoId: `local/merged/${current.id}`,
        createdAt: nowIso(),
        status: 'ready',
        path: mergedPath,
        error: null,
        fromLoraId: loraId,
        configPath,
        ...modelMeta,
      });

      const updated = await upsertLora({
        ...next,
        mergedModelId: modelId,
        mergedModelSize: size,
        mergedModelSizeHuman: formatSize(size),
      });

      emitEvent('lora_updated', updated);
      return updated;
    } catch (err) {
      logger.error('Failed to register merged model', {
        loraId,
        error: String(err.message || err),
      });
    }
  }

  return next;
}

async function finalizeMergeFailure(loraId, error, configPath, mergeLogFile) {
  const current = await getLoraById(loraId);
  if (!current) return null;

  const next = await upsertLora({
    ...current,
    mergeStatus: 'failed',
    mergePid: null,
    error: String(error || 'merge failed'),
    configPath,
    mergeLogFile,
  });

  emitEvent('lora_updated', next);
  return next;
}

async function reconcileLoraMergeState(item) {
  if (!item) return null;
  if (item.mergeStatus !== 'building') return item;

  if (item.mergePid && isPidRunning(item.mergePid)) {
    return item;
  }

  const mergedPath = item.mergedPath;
  const resultFile = mergedPath ? path.join(mergedPath, 'merge-result.json') : null;

  if (resultFile && fs.existsSync(resultFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      if (parsed?.ok) {
        logger.info('Reconciling finished merge from artifacts', {
          loraId: item.id,
          mergedPath,
        });
        return await finalizeMergeSuccess(item.id, mergedPath, item.configPath, item.mergeLogFile);
      }
    } catch (err) {
      logger.warn('Failed to parse merge-result.json during reconcile', {
        loraId: item.id,
        error: String(err.message || err),
      });
    }
  }

  logger.warn('Reconciling dead merge process as failed', {
    loraId: item.id,
    mergePid: item.mergePid,
  });

  return await finalizeMergeFailure(
    item.id,
    'Merge process exited but final status was not recorded',
    item.configPath,
    item.mergeLogFile,
  );
}

async function getLoraByIdSafe(id) {
  const item = await getLoraById(id);
  if (!item) return null;
  return reconcileLoraMergeState(item);
}

async function buildMergedLora(loraId, options = {}) {
  const item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  const settings = require('./state');
  const userSettings = await settings.getSettings();
  const mergeOptions = {
    ...(userSettings.merge || {}),
    ...(options || {}),
  };

  if (item.mergeStatus === 'building' && item.mergePid && isPidRunning(item.mergePid)) {
    return item;
  }

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
    stdio: ['ignore', outFd, outFd],
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
    },
  });

  const building = await upsertLora({
    ...next0,
    mergePid: child.pid,
    configPath,
  });
  emitEvent('lora_updated', building);

  child.on('exit', async (code) => {
    await unregisterManagedProcess(child.pid);

    logger.info('LoRA merge process exited', {
      loraId,
      code,
      configPath,
    });

    if (code === 0) {
      await finalizeMergeSuccess(loraId, mergedPath, configPath, mergeLogFile);
    } else {
      await finalizeMergeFailure(loraId, `merge exited with code ${code}`, configPath, mergeLogFile);
    }
  });

  child.on('error', async (err) => {
    await unregisterManagedProcess(child.pid);

    logger.error('LoRA merge process error', {
      loraId,
      configPath,
      error: String(err.message || err),
    });

    await finalizeMergeFailure(loraId, String(err.message || err), configPath, mergeLogFile);
  });

  return building;
}

async function ensureMergedLora(loraId) {
  let item = await getLoraByIdSafe(loraId);
  if (!item) throw new Error('lora not found');

  if (item.mergeStatus === 'ready' && item.mergedPath && fs.existsSync(item.mergedPath)) {
    return item;
  }

  if (item.mergeStatus !== 'building' || !item.mergePid || !isPidRunning(item.mergePid)) {
    await buildMergedLora(loraId);
  }

  while (true) {
    await sleep(2000);
    item = await getLoraByIdSafe(loraId);
    if (!item) throw new Error('lora not found');
    if (item.mergeStatus !== 'building') break;
  }

  if (item.mergeStatus === 'ready') return item;
  throw new Error(item.error || 'LoRA merge failed');
}

async function packageMergedLora(loraId) {
  let item = await getLoraByIdSafe(loraId);
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

    const current = await getLoraById(loraId);
    if (!current) return;

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

async function reconcileAllLoras() {
  const items = await getLoras();
  const out = [];
  for (const item of items) {
    out.push(await reconcileLoraMergeState(item));
  }
  return out;
}

module.exports = {
  registerLoraFromJob,
  buildMergedLora,
  ensureMergedLora,
  packageMergedLora,
  reconcileLoraMergeState,
  reconcileAllLoras,
  getLoraByIdSafe,
};