const { CONFIG } = require('../config');
const { ensureDir, exists, readJson, writeJson } = require('../utils/fs');

const locks = new Map();

/**
 * Ensures that the provided async function runs exclusively for the given key.
 * This prevents race conditions during read-modify-write cycles.
 */
async function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const next = (async () => {
    try {
      await previous;
    } catch (err) {
      // ignore errors from previous tasks in the queue
    }
    return await fn();
  })();
  locks.set(key, next);
  next.finally(() => {
    if (locks.get(key) === next) {
      locks.delete(key);
    }
  });
  return next;
}

const DEFAULT_SETTINGS = {
  baseModel: CONFIG.defaultBaseModel,
  qlora: {
    loadIn4bit: true,
    maxSeqLength: 4096,
    perDeviceTrainBatchSize: 1,
    gradientAccumulationSteps: 8,
    learningRate: 2e-4,
    numTrainEpochs: 3,
    warmupRatio: 0.03,
    loraR: 16,
    loraAlpha: 16,
    loraDropout: 0,
    targetModules: ['q_proj', 'k_proj', 'v_proj', 'o_proj', 'gate_proj', 'up_proj', 'down_proj'],
  },
  inference: {
    backend: 'vllm',
    model: CONFIG.defaultBaseModel,
    host: '0.0.0.0',
    port: CONFIG.vllmPort,
    gpuMemoryUtilization: 0.9,
    tensorParallelSize: 1,
    maxModelLen: 8192,
  },
};

async function ensureWorkspace() {
  for (const dir of [
    CONFIG.stateDir,
    CONFIG.datasetsDir,
    CONFIG.rawDatasetsDir,
    CONFIG.trainingConfigsDir,
    CONFIG.trainingOutputsDir,
    CONFIG.logsDir,
  ]) {
    await ensureDir(dir);
  }

  if (!exists(CONFIG.settingsFile)) await writeJson(CONFIG.settingsFile, DEFAULT_SETTINGS);
  if (!exists(CONFIG.jobsFile)) await writeJson(CONFIG.jobsFile, []);
  if (!exists(CONFIG.datasetsFile)) await writeJson(CONFIG.datasetsFile, []);
  if (!exists(CONFIG.runtimeFile)) {
    await writeJson(CONFIG.runtimeFile, {
      vllm: { pid: null, model: null, startedAt: null, port: CONFIG.vllmPort },
    });
  }
}

async function getSettings() {
  return (await readJson(CONFIG.settingsFile, DEFAULT_SETTINGS)) || DEFAULT_SETTINGS;
}

async function setSettings(next) {
  return withLock(CONFIG.settingsFile, async () => {
    const current = await getSettings();
    const merged = {
      ...current,
      ...next,
      qlora: { ...current.qlora, ...(next.qlora || {}) },
      inference: { ...current.inference, ...(next.inference || {}) },
    };
    await writeJson(CONFIG.settingsFile, merged);
    return merged;
  });
}

async function getJobs() {
  return (await readJson(CONFIG.jobsFile, [])) || [];
}

async function saveJobs(jobs) {
  await writeJson(CONFIG.jobsFile, jobs);
}

async function upsertJob(jobPatch) {
  return withLock(CONFIG.jobsFile, async () => {
    const jobs = await getJobs();
    const idx = jobs.findIndex((j) => j.id === jobPatch.id);
    let result;
    if (idx === -1) {
      jobs.push(jobPatch);
      result = jobPatch;
    } else {
      jobs[idx] = { ...jobs[idx], ...jobPatch };
      result = jobs[idx];
    }
    await saveJobs(jobs);
    return result;
  });
}

async function getDatasets() {
  return (await readJson(CONFIG.datasetsFile, [])) || [];
}

async function saveDatasets(items) {
  await writeJson(CONFIG.datasetsFile, items);
}

async function addDataset(meta) {
  return withLock(CONFIG.datasetsFile, async () => {
    const list = await getDatasets();
    list.push(meta);
    await saveDatasets(list);
    return meta;
  });
}

async function removeDataset(id) {
  return withLock(CONFIG.datasetsFile, async () => {
    const list = await getDatasets();
    const next = list.filter((x) => x.id !== id);
    await saveDatasets(next);
    return next;
  });
}

async function getRuntime() {
  return (await readJson(CONFIG.runtimeFile, { vllm: {} })) || { vllm: {} };
}

async function saveRuntime(next) {
  return withLock(CONFIG.runtimeFile, async () => {
    await writeJson(CONFIG.runtimeFile, next);
  });
}

async function recoverState() {
  const { isPidRunning } = require('../utils/proc');
  const { nowIso } = require('../utils/ids');

  // Recover jobs
  const jobs = await getJobs();
  let jobsChanged = false;
  for (let i = 0; i < jobs.length; i++) {
    if (jobs[i].status === 'running' || jobs[i].status === 'queued') {
      if (!jobs[i].pid || !isPidRunning(jobs[i].pid)) {
        jobs[i].status = 'failed';
        jobs[i].finishedAt = nowIso();
        jobs[i].error = 'Process lost after restart';
        jobsChanged = true;
      }
    }
  }
  if (jobsChanged) await saveJobs(jobs);

  // Recover runtime
  const runtime = await getRuntime();
  if (runtime.vllm?.pid && !isPidRunning(runtime.vllm.pid)) {
    await saveRuntime({
      ...runtime,
      vllm: {
        ...runtime.vllm,
        pid: null,
        startedAt: null,
      },
    });
  }

  // Recover LoRAs
  const loras = await getLoras();
  let lorasChanged = false;
  for (let i = 0; i < loras.length; i++) {
    if (loras[i].mergeStatus === 'building') {
      if (!loras[i].mergePid || !isPidRunning(loras[i].mergePid)) {
        loras[i].mergeStatus = 'failed';
        loras[i].error = 'Merge process lost after restart';
        lorasChanged = true;
      }
    }
    if (loras[i].packageStatus === 'building') {
      if (!loras[i].packagePid || !isPidRunning(loras[i].packagePid)) {
        loras[i].packageStatus = 'failed';
        loras[i].error = 'Package process lost after restart';
        lorasChanged = true;
      }
    }
  }
  if (lorasChanged) await saveLoras(loras);
}

module.exports = {
  DEFAULT_SETTINGS,
  ensureWorkspace,
  getSettings,
  setSettings,
  getJobs,
  saveJobs,
  upsertJob,
  getDatasets,
  saveDatasets,
  addDataset,
  removeDataset,
  getLoras,
  saveLoras,
  getRuntime,
  saveRuntime,
  recoverState,
};
