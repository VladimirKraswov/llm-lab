const { CONFIG } = require('../config');
const { ensureDir, exists, readJson, writeJson } = require('../utils/fs');

const locks = new Map();

async function withLock(key, fn) {
  while (locks.get(key)) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  locks.set(key, true);
  try {
    return await fn();
  } finally {
    locks.set(key, false);
  }
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

const DEFAULT_RUNTIME = {
  vllm: {
    pid: null,
    model: null,
    startedAt: null,
    port: CONFIG.vllmPort,
    logFile: CONFIG.vllmLogFile,
    baseModel: CONFIG.defaultBaseModel,
    activeModelId: null,
    activeModelName: null,
    activeLoraId: null,
    activeLoraName: null,
  },
};

async function ensureWorkspace() {
  for (const dir of [
    CONFIG.stateDir,
    CONFIG.modelsDir,
    CONFIG.datasetsDir,
    CONFIG.rawDatasetsDir,
    CONFIG.trainingConfigsDir,
    CONFIG.trainingOutputsDir,
    CONFIG.mergedModelsDir,
    CONFIG.packagesDir,
    CONFIG.logsDir,
  ]) {
    await ensureDir(dir);
  }

  if (!exists(CONFIG.settingsFile)) await writeJson(CONFIG.settingsFile, DEFAULT_SETTINGS);
  if (!exists(CONFIG.jobsFile)) await writeJson(CONFIG.jobsFile, []);
  if (!exists(CONFIG.datasetsFile)) await writeJson(CONFIG.datasetsFile, []);
  if (!exists(CONFIG.modelsFile)) await writeJson(CONFIG.modelsFile, []);
  if (!exists(CONFIG.lorasFile)) await writeJson(CONFIG.lorasFile, []);
  if (!exists(CONFIG.runtimeFile)) await writeJson(CONFIG.runtimeFile, DEFAULT_RUNTIME);
}

async function getSettings() {
  return (await readJson(CONFIG.settingsFile, DEFAULT_SETTINGS)) || DEFAULT_SETTINGS;
}

async function setSettings(next) {
  return await withLock('settings', async () => {
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
  return await withLock('jobs', async () => {
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
  return await withLock('datasets', async () => {
    const list = await getDatasets();
    list.push(meta);
    await saveDatasets(list);
    return meta;
  });
}

async function removeDataset(id) {
  return await withLock('datasets', async () => {
    const list = await getDatasets();
    const next = list.filter((x) => x.id !== id);
    await saveDatasets(next);
    return next;
  });
}

async function getModels() {
  return (await readJson(CONFIG.modelsFile, [])) || [];
}

async function saveModels(items) {
  await writeJson(CONFIG.modelsFile, items);
}

async function addModel(meta) {
  return await withLock('models', async () => {
    const list = await getModels();
    list.push(meta);
    await saveModels(list);
    return meta;
  });
}

async function upsertModel(modelPatch) {
  return await withLock('models', async () => {
    const list = await getModels();
    const idx = list.findIndex((x) => x.id === modelPatch.id);
    let result;
    if (idx === -1) {
      list.push(modelPatch);
      result = modelPatch;
    } else {
      list[idx] = { ...list[idx], ...modelPatch };
      result = list[idx];
    }
    await saveModels(list);
    return result;
  });
}

async function getModelById(id) {
  const list = await getModels();
  return list.find((x) => x.id === id) || null;
}

async function removeModel(id) {
  return await withLock('models', async () => {
    const list = await getModels();
    const next = list.filter((x) => x.id !== id);
    await saveModels(next);
    return next;
  });
}

async function getLoras() {
  return (await readJson(CONFIG.lorasFile, [])) || [];
}

async function saveLoras(items) {
  await writeJson(CONFIG.lorasFile, items);
}

async function addLora(meta) {
  return await withLock('loras', async () => {
    const list = await getLoras();
    list.push(meta);
    await saveLoras(list);
    return meta;
  });
}

async function upsertLora(loraPatch) {
  return await withLock('loras', async () => {
    const list = await getLoras();
    const idx = list.findIndex((x) => x.id === loraPatch.id);
    let result;
    if (idx === -1) {
      list.push(loraPatch);
      result = loraPatch;
    } else {
      list[idx] = { ...list[idx], ...loraPatch };
      result = list[idx];
    }
    await saveLoras(list);
    return result;
  });
}

async function getLoraById(id) {
  const list = await getLoras();
  return list.find((x) => x.id === id) || null;
}

async function getLoraByJobId(jobId) {
  const list = await getLoras();
  return list.find((x) => x.jobId === jobId) || null;
}

async function renameLora(id, name) {
  return await withLock('loras', async () => {
    const list = await getLoras();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) throw new Error('lora not found');
    list[idx] = { ...list[idx], name };
    await saveLoras(list);
    return list[idx];
  });
}

async function removeLora(id) {
  return await withLock('loras', async () => {
    const list = await getLoras();
    const next = list.filter((x) => x.id !== id);
    await saveLoras(next);
    return next;
  });
}

async function getRuntime() {
  const current = (await readJson(CONFIG.runtimeFile, DEFAULT_RUNTIME)) || DEFAULT_RUNTIME;
  return {
    ...DEFAULT_RUNTIME,
    ...current,
    vllm: {
      ...DEFAULT_RUNTIME.vllm,
      ...(current.vllm || {}),
    },
  };
}

async function saveRuntime(next) {
  return await withLock('runtime', async () => {
    const merged = {
      ...DEFAULT_RUNTIME,
      ...next,
      vllm: {
        ...DEFAULT_RUNTIME.vllm,
        ...((next && next.vllm) || {}),
      },
    };
    await writeJson(CONFIG.runtimeFile, merged);
    return merged;
  });
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_RUNTIME,
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
  getModels,
  saveModels,
  addModel,
  upsertModel,
  getModelById,
  removeModel,
  getLoras,
  saveLoras,
  addLora,
  upsertLora,
  getLoraById,
  getLoraByJobId,
  renameLora,
  removeLora,
  getRuntime,
  saveRuntime,
};