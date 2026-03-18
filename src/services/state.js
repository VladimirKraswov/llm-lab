const { CONFIG } = require('../config');
const { ensureDir, exists, readJson, writeJson } = require('../utils/fs');

const locks = new Map();

async function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const next = (async () => {
    try {
      await previous;
    } catch {
      // ignore previous errors
    }
    return fn();
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
  merge: {
    deviceStrategy: 'auto',
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
  quantization: {
    awq: {
      dtype: 'float16',
      numSamples: 32,
      maxSeqLen: 1024,
      bits: 4,
      groupSize: 128,
      sym: false,
      trustRemoteCode: true,
      calibrationMode: 'text_only',
    },
  },
  wandb: {
    enabled: false,
    mode: 'online',
    apiKey: '',
    project: 'llm-lab',
    entity: '',
    baseUrl: '',
    httpProxy: '',
    httpsProxy: '',
    noProxy: '',
  },
  inference: {
    provider: 'auto',
    model: CONFIG.defaultBaseModel,
    host: '0.0.0.0',
    port: CONFIG.vllmPort,
    gpuMemoryUtilization: 0.85,
    tensorParallelSize: 1,
    maxModelLen: 8192,
    maxNumSeqs: 256,
    swapSpace: 4,
    quantization: null,
    dtype: 'auto',
    trustRemoteCode: true,
    enforceEager: false,
    kvCacheDtype: 'auto',
  },
};

const DEFAULT_INFERENCE_RUNTIME = {
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
  providerRequested: 'auto',
  providerResolved: null,
  compatibilityRisk: null,
  compatibilityWarning: null,
  capabilities: {
    experimental: false,
    supportsStreaming: true,
    supportsLora: true,
    supportsAwq: true,
  },
  probe: {
    ok: false,
    status: 'idle',
    checkedAt: null,
    error: null,
  },
};

const DEFAULT_RUNTIME = {
  inference: DEFAULT_INFERENCE_RUNTIME,
  vllm: DEFAULT_INFERENCE_RUNTIME,
};

function normalizeRuntime(current) {
  const source = current?.inference || current?.vllm || DEFAULT_INFERENCE_RUNTIME;

  const inference = {
    ...DEFAULT_INFERENCE_RUNTIME,
    ...source,
    capabilities: {
      ...DEFAULT_INFERENCE_RUNTIME.capabilities,
      ...(source.capabilities || {}),
    },
    probe: {
      ...DEFAULT_INFERENCE_RUNTIME.probe,
      ...(source.probe || {}),
    },
  };

  return {
    inference,
    vllm: inference,
  };
}

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
    CONFIG.evalDatasetsDir,
  ]) {
    await ensureDir(dir);
  }

  if (!exists(CONFIG.settingsFile)) await writeJson(CONFIG.settingsFile, DEFAULT_SETTINGS);
  if (!exists(CONFIG.jobsFile)) await writeJson(CONFIG.jobsFile, []);
  if (!exists(CONFIG.datasetsFile)) await writeJson(CONFIG.datasetsFile, []);
  if (!exists(CONFIG.evalDatasetsFile)) await writeJson(CONFIG.evalDatasetsFile, []);
  if (!exists(CONFIG.modelsFile)) await writeJson(CONFIG.modelsFile, []);
  if (!exists(CONFIG.lorasFile)) await writeJson(CONFIG.lorasFile, []);
  if (!exists(CONFIG.runtimeFile)) await writeJson(CONFIG.runtimeFile, DEFAULT_RUNTIME);
  if (!exists(CONFIG.managedProcessesFile)) await writeJson(CONFIG.managedProcessesFile, []);
}

async function getSettings() {
  const current = (await readJson(CONFIG.settingsFile, DEFAULT_SETTINGS)) || DEFAULT_SETTINGS;
  return {
    ...DEFAULT_SETTINGS,
    ...current,
    qlora: {
      ...DEFAULT_SETTINGS.qlora,
      ...(current.qlora || {}),
    },
    merge: {
      ...DEFAULT_SETTINGS.merge,
      ...(current.merge || {}),
    },
    quantization: {
      ...DEFAULT_SETTINGS.quantization,
      ...(current.quantization || {}),
      awq: {
        ...DEFAULT_SETTINGS.quantization.awq,
        ...((current.quantization || {}).awq || {}),
      },
    },
    wandb: {
      ...DEFAULT_SETTINGS.wandb,
      ...(current.wandb || {}),
    },
    inference: {
      ...DEFAULT_SETTINGS.inference,
      ...(current.inference || {}),
    },
  };
}

async function setSettings(next) {
  return withLock(CONFIG.settingsFile, async () => {
    const current = await getSettings();
    const merged = {
      ...current,
      ...next,
      qlora: { ...current.qlora, ...(next.qlora || {}) },
      merge: { ...current.merge, ...(next.merge || {}) },
      quantization: {
        ...current.quantization,
        ...(next.quantization || {}),
        awq: {
          ...(current.quantization?.awq || {}),
          ...((next.quantization || {}).awq || {}),
        },
      },
      wandb: { ...current.wandb, ...(next.wandb || {}) },
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

async function getEvalDatasets() {
  return (await readJson(CONFIG.evalDatasetsFile, [])) || [];
}

async function saveEvalDatasets(items) {
  await writeJson(CONFIG.evalDatasetsFile, items);
}

async function addEvalDataset(meta) {
  return withLock(CONFIG.evalDatasetsFile, async () => {
    const list = await getEvalDatasets();
    list.push(meta);
    await saveEvalDatasets(list);
    return meta;
  });
}

async function removeEvalDataset(id) {
  return withLock(CONFIG.evalDatasetsFile, async () => {
    const list = await getEvalDatasets();
    const next = list.filter((x) => x.id !== id);
    await saveEvalDatasets(next);
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
  return withLock(CONFIG.modelsFile, async () => {
    const list = await getModels();
    list.push(meta);
    await saveModels(list);
    return meta;
  });
}

async function upsertModel(modelPatch) {
  return withLock(CONFIG.modelsFile, async () => {
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
  return withLock(CONFIG.modelsFile, async () => {
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
  return withLock(CONFIG.lorasFile, async () => {
    const list = await getLoras();
    list.push(meta);
    await saveLoras(list);
    return meta;
  });
}

async function upsertLora(loraPatch) {
  return withLock(CONFIG.lorasFile, async () => {
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
  return withLock(CONFIG.lorasFile, async () => {
    const list = await getLoras();
    const idx = list.findIndex((x) => x.id === id);
    if (idx === -1) throw new Error('lora not found');
    list[idx] = { ...list[idx], name };
    await saveLoras(list);
    return list[idx];
  });
}

async function removeLora(id) {
  return withLock(CONFIG.lorasFile, async () => {
    const list = await getLoras();
    const next = list.filter((x) => x.id !== id);
    await saveLoras(next);
    return next;
  });
}

async function getRuntime() {
  const current = (await readJson(CONFIG.runtimeFile, DEFAULT_RUNTIME)) || DEFAULT_RUNTIME;
  return normalizeRuntime(current);
}

async function saveRuntime(next) {
  return withLock(CONFIG.runtimeFile, async () => {
    const current = await getRuntime();
    const incoming = normalizeRuntime(next || {});
    const merged = normalizeRuntime({
      inference: {
        ...current.inference,
        ...incoming.inference,
        capabilities: {
          ...current.inference.capabilities,
          ...incoming.inference.capabilities,
        },
        probe: {
          ...current.inference.probe,
          ...incoming.inference.probe,
        },
      },
    });

    await writeJson(CONFIG.runtimeFile, merged);
    return merged;
  });
}

async function recoverState() {
  const { isPidRunning } = require('../utils/proc');
  const { nowIso } = require('../utils/ids');
  const { pruneDeadManagedProcesses } = require('../utils/managed-processes');

  await pruneDeadManagedProcesses();

  await withLock(CONFIG.jobsFile, async () => {
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

    if (jobsChanged) {
      await writeJson(CONFIG.jobsFile, jobs);
    }
  });

  await withLock(CONFIG.runtimeFile, async () => {
    const runtime = await getRuntime();

    if (runtime.inference?.pid && !isPidRunning(runtime.inference.pid)) {
      const next = normalizeRuntime({
        inference: {
          ...runtime.inference,
          pid: null,
          startedAt: null,
        },
      });
      await writeJson(CONFIG.runtimeFile, next);
    }
  });

  await withLock(CONFIG.lorasFile, async () => {
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

    if (lorasChanged) {
      await writeJson(CONFIG.lorasFile, loras);
    }
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
  getEvalDatasets,
  saveEvalDatasets,
  addEvalDataset,
  removeEvalDataset,
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
  recoverState,
};