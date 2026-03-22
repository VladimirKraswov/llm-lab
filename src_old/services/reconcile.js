const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { CONFIG } = require('../config');
const { uid, nowIso } = require('../utils/ids');
const logger = require('../utils/logger');
const { emitEvent } = require('./events');
const {
  getModels,
  replaceModels,
  getLoras,
  replaceLoras,
} = require('./state');

let activeRunPromise = null;

const reconcileState = {
  isRunning: false,
  currentRunId: null,
  lastRunId: null,
  lastReason: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastError: null,
  lastResult: null,
};

function getReconcileStatus() {
  return { ...reconcileState };
}

function isSkipDir(name) {
  return (
    !name ||
    name.startsWith('.') ||
    name === '__pycache__' ||
    name === '_offload' ||
    name === 'tmp' ||
    name === 'temp'
  );
}

async function normalizePathSafe(value) {
  try {
    const resolved = path.resolve(String(value || '').trim());
    if (!resolved) return null;

    try {
      return await fsp.realpath(resolved);
    } catch {
      return resolved;
    }
  } catch {
    return null;
  }
}

async function isExistingDir(dirPath) {
  try {
    return (await fsp.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function isExistingFile(filePath) {
  try {
    return (await fsp.stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    if (!String(raw).trim()) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function createdAtFromStat(stat) {
  if (stat?.birthtime instanceof Date && Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0) {
    return stat.birthtime.toISOString();
  }
  if (stat?.mtime instanceof Date) return stat.mtime.toISOString();
  return nowIso();
}

async function walkForMarkerDirs(rootDir, markerFile, maxDepth = 4) {
  const out = [];
  const visited = new Set();

  async function walk(currentDir, depth) {
    if (!(await isExistingDir(currentDir))) return;

    const normalized = await normalizePathSafe(currentDir);
    if (!normalized || visited.has(normalized)) return;
    visited.add(normalized);

    let entries = [];
    try {
      entries = await fsp.readdir(normalized, { withFileTypes: true });
    } catch {
      return;
    }

    if (entries.some((entry) => entry.isFile() && entry.name === markerFile)) {
      out.push(normalized);
      return;
    }

    if (depth >= maxDepth) return;

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (isSkipDir(entry.name)) continue;
      await walk(path.join(normalized, entry.name), depth + 1);
    }
  }

  await walk(rootDir, 0);
  return out;
}

async function buildNormalizedPathMap(items, pathField) {
  const map = new Map();

  for (const item of items) {
    const key = await normalizePathSafe(item?.[pathField]);
    if (!key) continue;
    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  return map;
}

async function extractModelMetaLight(modelDir) {
  const configPath = path.join(modelDir, 'config.json');
  const config = await readJsonIfExists(configPath);

  let quantization = 'none';

  if (config?.quantization_config?.quant_method) {
    quantization = String(config.quantization_config.quant_method).toLowerCase();
  } else if (config?.compression_config?.format) {
    quantization = String(config.compression_config.format).toLowerCase();
  } else if (config?.compression_config?.quantization_status) {
    quantization = 'compressed';
  } else {
    const lower = modelDir.toLowerCase();
    if (lower.includes('awq')) quantization = 'awq';
    else if (lower.includes('gptq')) quantization = 'gptq';
    else if (lower.includes('gguf')) quantization = 'gguf';
  }

  return {
    configPath,
    quantization,
    parameters: 'unknown',
    size: null,
    sizeHuman: null,
    vramEstimate: 'unknown',
  };
}

async function tryResolveExistingLocalDir(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const abs = path.resolve(raw);
    const stat = await fsp.stat(abs);
    if (!stat.isDirectory()) return null;
    return await normalizePathSafe(abs);
  } catch {
    return null;
  }
}

async function reconcileModelsFromFilesystem() {
  const existing = await getModels();
  const existingByPath = await buildNormalizedPathMap(existing, 'path');
  const discoveredDirs = await walkForMarkerDirs(CONFIG.modelsDir, 'config.json', 4);
  const discoveredSet = new Set(discoveredDirs);

  const next = [];
  let added = 0;
  let updated = 0;
  let removed = 0;
  let preservedActive = 0;

  for (const modelDir of discoveredDirs) {
    const current = existingByPath.get(modelDir);
    const stat = await fsp.stat(modelDir).catch(() => null);
    if (!stat) continue;

    const lightMeta = await extractModelMetaLight(modelDir);

    if (current) {
      next.push({
        ...current,
        path: modelDir,
        status: 'ready',
        error: null,
        configPath: lightMeta.configPath,
        quantization: lightMeta.quantization || current.quantization || 'none',
        parameters: current.parameters || lightMeta.parameters,
        size: current.size ?? lightMeta.size,
        sizeHuman: current.sizeHuman ?? lightMeta.sizeHuman,
        vramEstimate: current.vramEstimate ?? lightMeta.vramEstimate,
      });
      updated += 1;
      continue;
    }

    next.push({
      id: uid('model'),
      name: path.basename(modelDir),
      repoId: `local/fs/${path.basename(modelDir)}`,
      createdAt: createdAtFromStat(stat),
      status: 'ready',
      path: modelDir,
      logFile: null,
      pid: null,
      error: null,
      discoveredBy: 'filesystem-scan',
      ...lightMeta,
    });
    added += 1;
  }

  for (const item of existing) {
    const normalized = await normalizePathSafe(item?.path);
    if (!normalized) {
      removed += 1;
      continue;
    }

    if (discoveredSet.has(normalized)) continue;

    const pathExists = await isExistingDir(normalized);
    const isActive = item.status === 'downloading' || item.status === 'building';

    if (isActive && pathExists) {
      next.push(item);
      preservedActive += 1;
    } else {
      removed += 1;
    }
  }

  await replaceModels(next);

  return {
    totalAfter: next.length,
    added,
    updated,
    removed,
    preservedActive,
  };
}

async function reconcileLorasFromFilesystem() {
  const existing = await getLoras();
  const existingByPath = await buildNormalizedPathMap(existing, 'adapterPath');

  const models = await getModels();
  const modelsByPath = await buildNormalizedPathMap(models, 'path');

  const discoveredAdapters = await walkForMarkerDirs(CONFIG.trainingOutputsDir, 'adapter_config.json', 4);
  const discoveredSet = new Set(discoveredAdapters);

  const next = [];
  let added = 0;
  let updated = 0;
  let removed = 0;
  let preservedActive = 0;

  for (const adapterDir of discoveredAdapters) {
    const current = existingByPath.get(adapterDir);
    const stat = await fsp.stat(adapterDir).catch(() => null);
    if (!stat) continue;

    const adapterConfig = await readJsonIfExists(path.join(adapterDir, 'adapter_config.json'));
    const baseModelRefRaw =
      String(adapterConfig?.base_model_name_or_path || current?.baseModelRef || '').trim() || null;

    const localBasePath = await tryResolveExistingLocalDir(baseModelRefRaw);
    const linkedBaseModel = localBasePath ? modelsByPath.get(localBasePath) : null;

    const mergedPath = current?.mergedPath && (await isExistingDir(current.mergedPath))
      ? await normalizePathSafe(current.mergedPath)
      : null;

    const packagePath = current?.packagePath && (await isExistingFile(current.packagePath))
      ? path.resolve(current.packagePath)
      : null;

    const linkedMergedModel = mergedPath ? modelsByPath.get(mergedPath) : null;

    if (current) {
      next.push({
        ...current,
        adapterPath: adapterDir,
        status: 'ready',
        error: null,
        baseModelRef: baseModelRefRaw || current.baseModelRef || null,
        baseModelId: linkedBaseModel?.id || current.baseModelId || null,
        baseModelName:
          linkedBaseModel?.name ||
          current.baseModelName ||
          (localBasePath ? path.basename(localBasePath) : baseModelRefRaw || null),
        mergedPath,
        mergeStatus: mergedPath ? 'ready' : 'not_built',
        mergeProgress: mergedPath ? 100 : 0,
        mergePid: null,
        packagePath,
        packageStatus: packagePath ? 'ready' : 'not_built',
        packagePid: null,
        mergedModelId: linkedMergedModel?.id || (mergedPath ? current.mergedModelId || null : null),
      });
      updated += 1;
      continue;
    }

    next.push({
      id: uid('lora'),
      name: path.basename(adapterDir),
      jobId: null,
      baseModelId: linkedBaseModel?.id || null,
      baseModelName:
        linkedBaseModel?.name ||
        (localBasePath ? path.basename(localBasePath) : baseModelRefRaw || null),
      baseModelRef: baseModelRefRaw,
      adapterPath: adapterDir,
      mergedPath: null,
      packagePath: null,
      createdAt: createdAtFromStat(stat),
      status: 'ready',
      mergeStatus: 'not_built',
      mergeProgress: 0,
      mergePid: null,
      packageStatus: 'not_built',
      packagePid: null,
      error: null,
      configPath: null,
      mergeLogFile: null,
      mergeOptions: null,
      mergeArtifacts: [],
      mergedModelId: null,
      mergedModelSize: null,
      mergedModelSizeHuman: null,
      discoveredBy: 'filesystem-scan',
    });
    added += 1;
  }

  for (const item of existing) {
    const normalized = await normalizePathSafe(item?.adapterPath);
    if (!normalized) {
      removed += 1;
      continue;
    }

    if (discoveredSet.has(normalized)) continue;

    const pathExists = await isExistingDir(normalized);
    const isActive = item.mergeStatus === 'building' || item.packageStatus === 'building';

    if (isActive && pathExists) {
      next.push(item);
      preservedActive += 1;
    } else {
      removed += 1;
    }
  }

  await replaceLoras(next);

  return {
    totalAfter: next.length,
    added,
    updated,
    removed,
    preservedActive,
  };
}

async function runReconcile(runId, reason) {
  reconcileState.isRunning = true;
  reconcileState.currentRunId = runId;
  reconcileState.lastRunId = runId;
  reconcileState.lastReason = reason;
  reconcileState.lastStartedAt = nowIso();
  reconcileState.lastFinishedAt = null;
  reconcileState.lastError = null;

  emitEvent('reconcile_started', getReconcileStatus());
  logger.info('Background reconcile started', { runId, reason });

  try {
    const models = await reconcileModelsFromFilesystem();
    const loras = await reconcileLorasFromFilesystem();

    const result = {
      runId,
      reason,
      startedAt: reconcileState.lastStartedAt,
      finishedAt: nowIso(),
      models,
      loras,
    };

    reconcileState.isRunning = false;
    reconcileState.currentRunId = null;
    reconcileState.lastFinishedAt = result.finishedAt;
    reconcileState.lastResult = result;
    reconcileState.lastError = null;

    emitEvent('reconcile_completed', result);
    logger.info('Background reconcile completed', result);

    return result;
  } catch (err) {
    const message = String(err.message || err);

    reconcileState.isRunning = false;
    reconcileState.currentRunId = null;
    reconcileState.lastFinishedAt = nowIso();
    reconcileState.lastError = message;

    emitEvent('reconcile_failed', {
      runId,
      reason,
      error: message,
      finishedAt: reconcileState.lastFinishedAt,
    });

    logger.error('Background reconcile failed', {
      runId,
      reason,
      error: message,
    });

    throw err;
  }
}

function startBackgroundReconcile({ reason = 'manual' } = {}) {
  if (reconcileState.isRunning) {
    return {
      ok: true,
      started: false,
      alreadyRunning: true,
      status: getReconcileStatus(),
    };
  }

  const runId = uid('reconcile');

  reconcileState.isRunning = true;
  reconcileState.currentRunId = runId;
  reconcileState.lastRunId = runId;
  reconcileState.lastReason = reason;
  reconcileState.lastStartedAt = nowIso();
  reconcileState.lastFinishedAt = null;
  reconcileState.lastError = null;

  setImmediate(() => {
    activeRunPromise = runReconcile(runId, reason)
      .catch(() => {})
      .finally(() => {
        activeRunPromise = null;
      });
  });

  return {
    ok: true,
    started: true,
    runId,
    status: getReconcileStatus(),
  };
}

module.exports = {
  startBackgroundReconcile,
  getReconcileStatus,
};