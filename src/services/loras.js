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
} = require('./state');
const { isPidRunning } = require('../utils/proc');
const { emitEvent } = require('./events');
const logger = require('../utils/logger');
const { getDirSize, formatSize } = require('../utils/model-meta');
const { spawnPythonJsonScript } = require('../utils/python-runner');

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
  });

  const size = fs.existsSync(item.adapterPath) ? getDirSize(item.adapterPath) : 0;
  const withSize = { ...item, size, sizeHuman: formatSize(size) };

  const final = await upsertLora(withSize);
  emitEvent('lora_created', final);
  logger.info(`LoRA registered from job: ${final.name}`, { loraId: final.id, jobId });
  return final;
}

async function buildMergedLora(loraId) {
  const item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');
  if (item.mergeStatus === 'building' && item.mergePid && isPidRunning(item.mergePid)) {
    return item;
  }

  const mergedPath = path.join(CONFIG.mergedModelsDir, `${item.id}-merged`);
  fs.mkdirSync(CONFIG.mergedModelsDir, { recursive: true });
  fs.mkdirSync(CONFIG.trainingConfigsDir, { recursive: true });

  const next0 = await upsertLora({
    ...item,
    mergeStatus: 'building',
    mergeProgress: 0,
    mergedPath,
    mergePid: null,
    error: null,
    configPath: null,
  });
  emitEvent('lora_updated', next0);

  const scriptPath = path.join(CONFIG.workspace, 'src', 'python', 'merge_lora.py');
  const payload = {
    adapterPath: item.adapterPath,
    outputDir: mergedPath,
  };

  const { child, configPath } = await spawnPythonJsonScript({
    pythonBin: CONFIG.pythonBin,
    scriptPath,
    payload,
    cwd: CONFIG.workspace,
    detached: true,
    stdio: 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    configDir: CONFIG.trainingConfigsDir,
    configPrefix: `merge-${loraId}`,
    logLabel: `merge-lora:${loraId}`,
  });

  child.unref();

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
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.startsWith('__PROGRESS__:')) {
        const p = parseInt(line.split(':')[1], 10);
        const cur = await getLoraById(loraId);
        if (cur) {
          const next = await upsertLora({ ...cur, mergeProgress: p });
          emitEvent('lora_updated', next);
        }
      }
    }
  });

  child.on('exit', async (code) => {
    logger.info('LoRA merge process exited', {
      loraId,
      code,
      configPath,
    });

    const current = await getLoraById(loraId);
    if (!current) return;

    const isOk = code === 0;

    const next = await upsertLora({
      ...current,
      mergeStatus: isOk ? 'ready' : 'failed',
      mergeProgress: isOk ? 100 : current.mergeProgress,
      mergePid: null,
      mergedPath: isOk ? mergedPath : current.mergedPath,
      error: isOk ? null : (stderr.trim() || `exit code ${code}`),
      configPath,
    });
    emitEvent('lora_updated', next);

    if (isOk) {
      logger.info(`LoRA merge completed: ${loraId}`, { mergedPath, configPath });

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
        });
        logger.info(`Merged model added to library`, { modelId, loraId, configPath });
      } catch (err) {
        logger.error(`Failed to add merged model to library`, {
          error: err.message,
          loraId,
          configPath,
        });
      }
    } else {
      logger.error(`LoRA merge failed: ${loraId}`, {
        error: next.error,
        configPath,
      });
    }
  });

  child.on('error', async (err) => {
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    if (code === 0) {
      logger.info('LoRA package completed', {
        loraId,
        archivePath,
      });
    } else {
      logger.error('LoRA package failed', {
        loraId,
        archivePath,
        error: next.error,
      });
    }
  });

  child.on('error', async (err) => {
    logger.error('LoRA package process error', {
      loraId,
      archivePath,
      error: String(err.message || err),
    });

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
};