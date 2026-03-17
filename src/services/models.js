const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config');
const { uid, nowIso } = require('../utils/ids');
const { addModel, getModels, getModelById, removeModel, upsertModel } = require('./state');
const { emitEvent } = require('./events');
const { readText } = require('../utils/fs');
const logger = require('../utils/logger');
const { getModelMetadata } = require('../utils/model-meta');
const { spawnPythonJsonScript } = require('../utils/python-runner');
const {
  registerManagedProcess,
  unregisterManagedProcess,
} = require('../utils/managed-processes');

function safeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function resolveQuantizePythonBin(runner) {
  if (runner === 'ml_env') return CONFIG.pythonBin;
  return CONFIG.quantizePythonBin || CONFIG.pythonBin;
}

function normalizeQuantizationValue(value) {
  if (value == null) return null;
  const v = String(value).trim().toLowerCase();
  if (!v || v === 'none' || v === 'null' || v === 'false') return null;
  return v;
}

function detectModelCapability(model) {
  const quantized = !!normalizeQuantizationValue(model.quantization);

  if (model.status !== 'ready') {
    return {
      supported: false,
      methods: [],
      runner: 'quant_env',
      experimental: true,
      reason: 'Model is not ready',
    };
  }

  if (quantized) {
    return {
      supported: false,
      methods: [],
      runner: 'quant_env',
      experimental: false,
      reason: 'Model is already quantized',
    };
  }

  return {
    supported: true,
    methods: ['awq'],
    runner: 'quant_env',
    experimental: true,
    reason: null,
  };
}

async function downloadModel({ repoId, name, tryQuantized }) {
  if (!repoId) throw new Error('repoId is required');

  let targetRepoId = repoId;
  if (tryQuantized && !repoId.toLowerCase().endsWith('-awq')) {
    targetRepoId = `${repoId}-AWQ`;
  }

  const existing = (await getModels()).find((x) => x.repoId === targetRepoId && x.status !== 'deleted');
  if (existing) return existing;

  const modelId = uid('model');
  const slug = safeSlug(name || targetRepoId.split('/').pop() || modelId);
  const modelPath = path.join(CONFIG.modelsDir, `${slug}-${modelId}`);
  const logFile = path.join(CONFIG.logsDir, `${modelId}.log`);

  const item = await addModel({
    id: modelId,
    name: name || targetRepoId.split('/').pop() || modelId,
    repoId: targetRepoId,
    createdAt: nowIso(),
    status: 'downloading',
    path: modelPath,
    logFile,
    pid: null,
    error: null,
    configPath: null,
  });

  emitEvent('model_updated', item);

  fs.mkdirSync(CONFIG.modelsDir, { recursive: true });
  fs.mkdirSync(CONFIG.logsDir, { recursive: true });
  fs.mkdirSync(CONFIG.trainingConfigsDir, { recursive: true });

  const scriptPath = path.join(__dirname, '..', 'python', 'download_model.py');
  const payload = {
    repoId: targetRepoId,
    localDir: modelPath,
  };

  const outFd = fs.openSync(logFile, 'a');
  const { child, configPath } = await spawnPythonJsonScript({
    pythonBin: CONFIG.pythonBin,
    scriptPath,
    payload,
    cwd: CONFIG.workspace,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    configDir: CONFIG.trainingConfigsDir,
    configPrefix: modelId,
    logLabel: `download-model:${modelId}`,
  });

  child.unref();

  await registerManagedProcess({
    pid: child.pid,
    type: 'model-download',
    label: `download-model:${modelId}`,
    meta: {
      modelId,
      repoId: targetRepoId,
      modelPath,
      logFile,
    },
  });

  const running = await upsertModel({
    ...item,
    pid: child.pid,
    configPath,
  });
  emitEvent('model_updated', running);

  child.on('exit', async (code) => {
    await unregisterManagedProcess(child.pid);

    logger.info('Model download process exited', {
      modelId,
      code,
      configPath,
    });

    const next = await upsertModel({
      ...running,
      status: code === 0 ? 'ready' : 'failed',
      error: code === 0 ? null : `download exited with code ${code}`,
      pid: null,
      configPath,
    });
    emitEvent('model_updated', next);

    if (code === 0) {
      const meta = getModelMetadata(next.path);
      const withMeta = await upsertModel({
        ...next,
        ...meta,
      });
      emitEvent('model_updated', withMeta);
      logger.info(`Model downloaded successfully: ${next.name}`, { modelId: next.id });
    } else {
      logger.error(`Model download failed: ${next.name}`, {
        modelId: next.id,
        error: next.error,
        configPath,
      });
    }
  });

  child.on('error', async (err) => {
    await unregisterManagedProcess(child.pid);

    logger.error('Model download process error', {
      modelId,
      configPath,
      error: String(err.message || err),
    });

    const next = await upsertModel({
      ...running,
      status: 'failed',
      error: String(err.message || err),
      pid: null,
      configPath,
    });
    emitEvent('model_updated', next);
  });

  return running;
}

async function deleteModel(modelId) {
  const item = await getModelById(modelId);
  if (!item) throw new Error('model not found');

  if (item.path && fs.existsSync(item.path)) {
    fs.rmSync(item.path, { recursive: true, force: true });
  }

  await removeModel(modelId);
  emitEvent('model_deleted', { id: modelId });
  logger.info(`Model deleted: ${item.name}`, { modelId });

  return { ok: true };
}

async function quantizeModel({
  modelId,
  method,
  name,
  datasetPath,
  numSamples,
  maxSeqLen,
  bits,
  groupSize,
  sym,
  runner,
}) {
  const source = await getModelById(modelId);
  if (!source) throw new Error('source model not found');
  if (source.status !== 'ready') throw new Error('source model is not ready');

  const effectiveMethod = String(method || 'awq').toLowerCase();
  if (effectiveMethod !== 'awq') {
    throw new Error(`Unsupported quantization method: ${method}`);
  }

  const effectiveRunner = runner || 'quant_env';

  const existing = (await getModels()).find(m =>
    m.sourceModelId === modelId &&
    m.quantization === effectiveMethod &&
    m.status === 'ready' &&
    m.runner === effectiveRunner &&
    (!bits || m.bits === bits) &&
    (!groupSize || m.groupSize === groupSize) &&
    (sym === undefined || m.sym === sym)
  );
  if (existing) {
    return {
      ...existing,
      jobId: existing.id,
    };
  }

  const newId = uid('model');
  const methodLabel = effectiveMethod;
  const slug = safeSlug(name || `${source.name}-${methodLabel}`);
  const modelPath = path.join(CONFIG.modelsDir, `${slug}-${newId}`);
  const logFile = path.join(CONFIG.logsDir, `${newId}.log`);

  const item = await addModel({
    id: newId,
    name: name || `${source.name} (${methodLabel})`,
    repoId: `local/quantized/${source.id}`,
    createdAt: nowIso(),
    status: 'building',
    path: modelPath,
    logFile,
    pid: null,
    error: null,
    quantization: effectiveMethod,
    bits: bits || 4,
    groupSize: groupSize || 128,
    sym: sym !== undefined ? sym : false,
    sourceModelId: modelId,
    configPath: null,
    runner: effectiveRunner,
    envName: effectiveRunner,
  });

  emitEvent('model_updated', item);

  fs.mkdirSync(modelPath, { recursive: true });
  fs.mkdirSync(CONFIG.logsDir, { recursive: true });
  fs.mkdirSync(CONFIG.trainingConfigsDir, { recursive: true });

  const scriptFile = 'quantize_llm_compressor.py';
  const payload = {
    modelPath: source.path,
    outputDir: modelPath,
    method: effectiveMethod,
    datasetPath,
    numSamples,
    maxSeqLen,
    bits,
    groupSize,
    sym,
    trustRemoteCode: true,
  };

  const scriptPath = path.join(__dirname, '..', 'python', scriptFile);
  const outFd = fs.openSync(logFile, 'a');

  const { child, configPath } = await spawnPythonJsonScript({
    pythonBin: resolveQuantizePythonBin(effectiveRunner),
    scriptPath,
    payload,
    cwd: CONFIG.workspace,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    configDir: CONFIG.trainingConfigsDir,
    configPrefix: newId,
    logLabel: `quantize-model:${newId}`,
  });

  child.unref();

  await registerManagedProcess({
    pid: child.pid,
    type: 'model-quantize',
    label: `quantize-model:${newId}`,
    meta: {
      modelId: newId,
      sourceModelId: modelId,
      method: effectiveMethod,
      runner: effectiveRunner,
      modelPath,
      logFile,
    },
  });

  const running = await upsertModel({
    ...item,
    pid: child.pid,
    configPath,
  });

  const { upsertJob } = require('./state');
  await upsertJob({
    id: newId,
    type: 'model-quantize',
    name: item.name,
    status: 'running',
    createdAt: item.createdAt,
    startedAt: nowIso(),
    modelId: modelId,
    modelPath: source.path,
    outputDir: modelPath,
    logFile: logFile,
    pid: child.pid,
    runner: effectiveRunner,
    paramsSnapshot: {
      ...payload,
      runner: effectiveRunner,
      effectiveMethod,
    },
  });
  emitEvent('model_updated', running);

  child.on('exit', async (code) => {
    await unregisterManagedProcess(child.pid);

    logger.info('Model quantization process exited', {
      modelId: newId,
      sourceModelId: modelId,
      code,
      method: effectiveMethod,
      runner: effectiveRunner,
      configPath,
    });

    const isOk = code === 0;
    const meta = isOk ? getModelMetadata(modelPath) : {};
    const next = await upsertModel({
      ...running,
      ...meta,
      status: isOk ? 'ready' : 'failed',
      error: isOk ? null : `quantization exited with code ${code}`,
      pid: null,
      configPath,
      runner: effectiveRunner,
      envName: effectiveRunner,
    });

    const { upsertJob: upsertJobSync } = require('./state');
    await upsertJobSync({
      id: newId,
      status: isOk ? 'completed' : 'failed',
      finishedAt: nowIso(),
      error: isOk ? null : `quantization exited with code ${code}`,
      pid: null,
      runner: effectiveRunner,
      summaryMetrics: {
        size: meta.size,
        sizeHuman: meta.sizeHuman,
      },
    });
    emitEvent('model_updated', next);

    if (isOk) {
      logger.info('Model quantization completed', {
        modelId: newId,
        sourceModelId: modelId,
        method: effectiveMethod,
        runner: effectiveRunner,
        configPath,
      });
    } else {
      logger.error('Model quantization failed', {
        modelId: newId,
        sourceModelId: modelId,
        method: effectiveMethod,
        runner: effectiveRunner,
        error: next.error,
        configPath,
      });
    }
  });

  child.on('error', async (err) => {
    await unregisterManagedProcess(child.pid);

    logger.error('Model quantization process error', {
      modelId: newId,
      sourceModelId: modelId,
      method: effectiveMethod,
      runner: effectiveRunner,
      configPath,
      error: String(err.message || err),
    });

    const next = await upsertModel({
      ...running,
      status: 'failed',
      error: String(err.message || err),
      pid: null,
      configPath,
      runner: effectiveRunner,
      envName: effectiveRunner,
    });

    const { upsertJob: upsertJobErr } = require('./state');
    await upsertJobErr({
      id: newId,
      status: 'failed',
      finishedAt: nowIso(),
      error: String(err.message || err),
      pid: null,
      runner: effectiveRunner,
    });
    emitEvent('model_updated', next);
  });

  return {
    ...running,
    jobId: newId,
  };
}

async function getModelLogs(id, tail = 200) {
  const item = await getModelById(id);
  if (!item) throw new Error('model not found');

  const text = await readText(item.logFile, '');
  const lines = text.split('\n');
  return {
    id: item.id,
    logFile: item.logFile,
    content: lines.slice(-tail).join('\n'),
  };
}

module.exports = {
  downloadModel,
  deleteModel,
  getModelLogs,
  quantizeModel,
  detectModelCapability,
};