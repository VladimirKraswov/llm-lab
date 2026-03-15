const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { CONFIG } = require('../config');
const { nowIso } = require('../utils/ids');
const { isPidRunning } = require('../utils/proc');
const { getRuntime, saveRuntime, getSettings } = require('./state');
const { emitEvent } = require('./events');
const logger = require('../utils/logger');
const { clearGpuMemory } = require('../utils/gpu');
const { readText, removeFile } = require('../utils/fs');
const providers = require('./providers');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateInferenceParams(params = {}) {
  if (
    params.port !== undefined &&
    (!Number.isInteger(params.port) || params.port < 1 || params.port > 65535)
  ) {
    throw new Error('port must be an integer between 1 and 65535');
  }

  if (
    params.gpuMemoryUtilization !== undefined &&
    (typeof params.gpuMemoryUtilization !== 'number' ||
      params.gpuMemoryUtilization <= 0 ||
      params.gpuMemoryUtilization > 1)
  ) {
    throw new Error('gpuMemoryUtilization must be between 0 and 1');
  }

  if (
    params.maxModelLen !== undefined &&
    (!Number.isInteger(params.maxModelLen) || params.maxModelLen < 1)
  ) {
    throw new Error('maxModelLen must be a positive integer');
  }

  if (
    params.maxNumSeqs !== undefined &&
    (!Number.isInteger(params.maxNumSeqs) || params.maxNumSeqs < 1)
  ) {
    throw new Error('maxNumSeqs must be a positive integer');
  }

  if (
    params.swapSpace !== undefined &&
    (!Number.isInteger(params.swapSpace) || params.swapSpace < 0)
  ) {
    throw new Error('swapSpace must be a non-negative integer');
  }

  if (
    params.tensorParallelSize !== undefined &&
    (!Number.isInteger(params.tensorParallelSize) || params.tensorParallelSize < 1)
  ) {
    throw new Error('tensorParallelSize must be a positive integer');
  }
}

function mapTorchDtypeToVllm(torchDtype) {
  switch (String(torchDtype || '').toLowerCase()) {
    case 'float16':
      return 'half';
    case 'float32':
      return 'float';
    case 'bfloat16':
      return 'bfloat16';
    default:
      return null;
  }
}

function resolveModelConfig(modelRef) {
  const result = {
    exists: false,
    configPath: null,
    raw: null,
    detected: {
      quantization: null,
      dtype: null,
      maxModelLen: null,
      slidingWindow: null,
      modelType: null,
    },
  };

  try {
    const normalized = String(modelRef || '').trim();
    if (!normalized) return result;

    const configPath = path.join(normalized, 'config.json');
    if (!fs.existsSync(configPath)) {
      return result;
    }

    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const quantMethod = raw?.quantization_config?.quant_method || null;
    const torchDtype = raw?.torch_dtype || null;
    const maxPositionEmbeddings = Number(raw?.max_position_embeddings || 0) || null;
    const slidingWindow = Number(raw?.sliding_window || 0) || null;
    const modelType = raw?.model_type || null;

    result.exists = true;
    result.configPath = configPath;
    result.raw = raw;
    result.detected = {
      quantization: quantMethod ? String(quantMethod).toLowerCase() : null,
      dtype: mapTorchDtypeToVllm(torchDtype),
      maxModelLen: maxPositionEmbeddings,
      slidingWindow,
      modelType,
    };

    return result;
  } catch (err) {
    logger.warn('Failed to read model config.json', {
      model: modelRef,
      error: String(err.message || err),
    });
    return result;
  }
}

function hasOwn(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function resolveQuantization(params, inf, detected) {
  if (hasOwn(params, 'quantization')) {
    return params.quantization;
  }
  if (inf.quantization !== undefined && inf.quantization !== null && inf.quantization !== '') {
    return inf.quantization;
  }
  return detected.quantization ?? null;
}

function resolveDtype(params, inf, detected) {
  if (hasOwn(params, 'dtype') && params.dtype && params.dtype !== 'auto') {
    return params.dtype;
  }
  if (inf.dtype && inf.dtype !== 'auto') {
    return inf.dtype;
  }

  // Fallback for AWQ models: use half if auto is requested
  if (detected.quantization === 'awq' && (!detected.dtype || detected.dtype === 'auto')) {
    return 'half';
  }

  return detected.dtype ?? 'auto';
}

function resolveMaxModelLen(params, inf, detected) {
  const requested = Number(params.maxModelLen ?? inf.maxModelLen ?? 8192);
  const limit = detected.maxModelLen;

  if (limit && requested > limit) {
    logger.warn('Requested maxModelLen exceeds model limit, clamping', {
      requested,
      limit,
    });
    return limit;
  }

  return requested;
}

async function startVllmRuntime(params = {}) {
  const settings = await getSettings();
  const inf = settings.inference || {};

  const requestedModel = String(params.model ?? inf.model ?? settings.baseModel ?? '').trim();
  if (!requestedModel) {
    throw new Error('model is required');
  }

  const modelCfg = resolveModelConfig(requestedModel);

  const merged = {
    model: requestedModel,
    port: Number(params.port ?? inf.port ?? CONFIG.vllmPort),
    maxModelLen: resolveMaxModelLen(params, inf, modelCfg.detected),
    gpuMemoryUtilization: Number(
      params.gpuMemoryUtilization ?? inf.gpuMemoryUtilization ?? 0.9,
    ),
    tensorParallelSize: Number(params.tensorParallelSize ?? inf.tensorParallelSize ?? 1),
    maxNumSeqs: Number(params.maxNumSeqs ?? inf.maxNumSeqs ?? 256),
    swapSpace: Number(params.swapSpace ?? inf.swapSpace ?? 4),
    quantization: resolveQuantization(params, inf, modelCfg.detected),
    dtype: resolveDtype(params, inf, modelCfg.detected),
    trustRemoteCode: params.trustRemoteCode ?? inf.trustRemoteCode ?? true,
    enforceEager: params.enforceEager ?? inf.enforceEager ?? false,
    kvCacheDtype: params.kvCacheDtype ?? inf.kvCacheDtype ?? 'auto',
    baseModel: params.baseModel ?? null,
    activeModelId: params.activeModelId ?? null,
    activeModelName: params.activeModelName ?? null,
    activeLoraId: params.activeLoraId ?? null,
    activeLoraName: params.activeLoraName ?? null,
    loraPath: params.loraPath ?? null,
    loraName: params.loraName ?? null,
    provider: params.provider ?? inf.provider ?? 'auto',
  };

  validateInferenceParams(merged);

  const {
    model,
    port,
    baseModel = null,
    activeModelId = null,
    activeModelName = null,
    activeLoraId = null,
    activeLoraName = null,
    provider: requestedProviderId,
  } = merged;

  if (!fs.existsSync(CONFIG.pythonBin)) {
    throw new Error(`Python binary not found: ${CONFIG.pythonBin}`);
  }

  const { provider, compatibility } = await providers.resolveProvider(requestedProviderId, modelCfg.detected);

  logger.info('Resolved inference provider', {
    requested: requestedProviderId,
    resolved: provider.id,
    compatibility,
  });

  await clearGpuMemory();

  const runtime = await getRuntime();
  if (runtime.vllm?.pid && isPidRunning(runtime.vllm.pid)) {
    await stopVllmRuntime();
  }

  fs.mkdirSync(CONFIG.logsDir, { recursive: true });
  fs.mkdirSync(CONFIG.trainingConfigsDir, { recursive: true });

  const pid = await provider.start({
    ...merged,
    modelConfigPath: modelCfg.configPath,
  });

  await fsp.writeFile(CONFIG.vllmPidFile, String(pid), 'utf8');

  let healthy = false;

  try {
    for (let i = 0; i < 120; i += 1) {
      const h = await provider.health({ port });
      if (h.ok) {
        healthy = true;
        break;
      }

      if (!isPidRunning(pid)) {
        const logs = await readText(CONFIG.vllmLogFile, '');
        const lastLines = logs.split('\n').slice(-50).join('\n');
        throw new Error(`Provider process exited during startup. Last logs:\n${lastLines}`);
      }
      await sleep(1000);
    }

    if (!healthy) {
      throw new Error(`Provider did not become healthy within timeout.`);
    }
  } catch (err) {
    await provider.stop({ pid });
    await removeFile(CONFIG.vllmPidFile).catch(() => {});
    throw err;
  }

  const nextState = {
    vllm: {
      pid,
      model,
      startedAt: nowIso(),
      port,
      logFile: CONFIG.vllmLogFile,
      baseModel: baseModel || settings.baseModel,
      activeModelId,
      activeModelName,
      activeLoraId,
      activeLoraName,
      providerRequested: requestedProviderId,
      providerResolved: provider.id,
      compatibilityRisk: compatibility.risk,
      compatibilityWarning: compatibility.warning || null,
      probe: {
        ok: false,
        status: 'checking',
        checkedAt: nowIso(),
        error: null,
      },
    },
  };

  await saveRuntime(nextState);

  // Probe
  logger.info('Performing model probe...', { provider: provider.id });
  const probeResult = await provider.probe(nextState.vllm);

  const finalState = {
    vllm: {
      ...nextState.vllm,
      probe: {
        ok: probeResult.ok,
        status: probeResult.ok ? 'success' : 'failed',
        checkedAt: nowIso(),
        error: probeResult.error || null,
      },
    },
  };

  await saveRuntime(finalState);
  emitEvent('runtime_started', finalState.vllm);

  logger.info('Runtime started successfully', {
    provider: provider.id,
    probe: finalState.vllm.probe,
  });

  return finalState.vllm;
}

async function stopVllmRuntime() {
  const runtime = await getRuntime();
  const pid = runtime.vllm?.pid;
  const providerId = runtime.vllm?.providerResolved;

  if (pid && isPidRunning(pid)) {
    const provider = providers.PROVIDERS[providerId] || providers.PROVIDERS.vllm;
    await provider.stop(runtime.vllm);
  }

  await removeFile(CONFIG.vllmPidFile).catch(() => {});
  const settings = await getSettings();

  const next = {
    vllm: {
      pid: null,
      model: null,
      startedAt: null,
      port: CONFIG.vllmPort,
      logFile: CONFIG.vllmLogFile,
      configPath: null,
      baseModel: settings.baseModel,
      activeModelId: null,
      activeModelName: null,
      activeLoraId: null,
      activeLoraName: null,
      providerRequested: 'auto',
      providerResolved: null,
      compatibilityRisk: null,
      compatibilityWarning: null,
      probe: {
        ok: false,
        status: 'idle',
        checkedAt: null,
        error: null,
      },
    },
  };

  await saveRuntime(next);
  emitEvent('runtime_stopped', next.vllm);
  logger.info('Runtime stopped');

  return next.vllm;
}

async function getRuntimeHealth(port) {
  const runtime = await getRuntime();
  const targetPort = port || runtime.vllm?.port || CONFIG.vllmPort;
  const providerId = runtime.vllm?.providerResolved || 'vllm';
  const provider = providers.PROVIDERS[providerId] || providers.PROVIDERS.vllm;

  try {
    const h = await provider.health({ port: targetPort });
    return {
      ok: h.ok,
      port: targetPort,
      raw: h.status,
    };
  } catch (err) {
    return {
      ok: false,
      port: targetPort,
      raw: String(err.message || err),
    };
  }
}

module.exports = {
  startVllmRuntime,
  stopVllmRuntime,
  getRuntimeHealth,
};
