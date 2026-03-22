// services/runtime.js
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
const {
  registerManagedProcess,
  unregisterManagedProcess,
} = require('../utils/managed-processes');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Валидация параметров запуска инференса
 * @throws {Error} если параметры некорректны
 */
function validateInferenceParams(params = {}) {
  if (params.port !== undefined && (!Number.isInteger(params.port) || params.port < 1 || params.port > 65535)) {
    throw new Error('port must be an integer between 1 and 65535');
  }

  if (
    params.gpuMemoryUtilization !== undefined &&
    (typeof params.gpuMemoryUtilization !== 'number' ||
      params.gpuMemoryUtilization <= 0 ||
      params.gpuMemoryUtilization > 1)
  ) {
    throw new Error('gpuMemoryUtilization must be a number between 0 and 1');
  }

  if (params.maxModelLen !== undefined && (!Number.isInteger(params.maxModelLen) || params.maxModelLen < 512)) {
    throw new Error('maxModelLen must be an integer >= 512');
  }

  if (params.maxNumSeqs !== undefined && (!Number.isInteger(params.maxNumSeqs) || params.maxNumSeqs < 1)) {
    throw new Error('maxNumSeqs must be a positive integer');
  }

  if (params.swapSpace !== undefined && (!Number.isInteger(params.swapSpace) || params.swapSpace < 0)) {
    throw new Error('swapSpace must be a non-negative integer');
  }

  if (
    params.tensorParallelSize !== undefined &&
    (!Number.isInteger(params.tensorParallelSize) || params.tensorParallelSize < 1)
  ) {
    throw new Error('tensorParallelSize must be a positive integer');
  }
}

/**
 * Маппинг torch dtype → vLLM dtype
 */
function mapTorchDtypeToVllm(torchDtype) {
  const mapping = {
    float16: 'half',
    float32: 'float',
    bfloat16: 'bfloat16',
  };
  return mapping[String(torchDtype || '').toLowerCase()] ?? null;
}

/**
 * Чтение и анализ config.json модели (если существует)
 */
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

    result.exists = true;
    result.configPath = configPath;
    result.raw = raw;

    const quantMethod = raw?.quantization_config?.quant_method ?? null;
    const torchDtype = raw?.torch_dtype ?? null;
    const maxPosEmb = Number(raw?.max_position_embeddings ?? 0) || null;
    const sliding = Number(raw?.sliding_window ?? 0) || null;
    const modelType = raw?.model_type ?? null;

    result.detected = {
      quantization: quantMethod ? String(quantMethod).toLowerCase() : null,
      dtype: mapTorchDtypeToVllm(torchDtype),
      maxModelLen: maxPosEmb,
      slidingWindow: sliding,
      modelType,
    };

    return result;
  } catch (err) {
    logger.warn('Не удалось прочитать/распарсить config.json модели', {
      model: modelRef,
      error: err.message,
    });
    return result;
  }
}

function resolveQuantization(params, settingsInf, detected) {
  if (params.quantization !== undefined && params.quantization !== null) {
    return params.quantization;
  }
  if (settingsInf.quantization !== undefined && settingsInf.quantization !== null) {
    return settingsInf.quantization;
  }
  return detected.quantization ?? null;
}

function resolveDtype(params, settingsInf, detected) {
  if (params.dtype && params.dtype !== 'auto') return params.dtype;
  if (settingsInf.dtype && settingsInf.dtype !== 'auto') return settingsInf.dtype;

  // Для AWQ часто лучше half
  if (detected.quantization === 'awq' && (!detected.dtype || detected.dtype === 'auto')) {
    return 'half';
  }

  return detected.dtype ?? 'auto';
}

function resolveMaxModelLen(params, settingsInf, detected) {
  const requested = Number(params.maxModelLen ?? settingsInf.maxModelLen ?? 8192);
  const limit = detected.maxModelLen;

  if (limit && requested > limit) {
    logger.warn('Запрошенный maxModelLen превышает лимит модели → обрезаем', {
      requested,
      limit,
      model: params.model,
    });
    return limit;
  }

  return requested;
}

function buildStoppedInferenceState(settings, overrides = {}) {
  return {
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
    ...overrides,
  };
}

/**
 * Запуск runtime (vLLM или transformers)
 * @param {Object} params - параметры запуска
 * @returns {Promise<Object>} состояние runtime после запуска
 */
async function startRuntime(params = {}) {
  const settings = await getSettings();
  const inf = settings.inference || {};

  // ──────────────────────────────────────────────
  // 1. Нормализация и проверка пути к модели
  // ──────────────────────────────────────────────
  let requestedModel = String(params.model ?? inf.model ?? settings.baseModel ?? '').trim();
  if (!requestedModel) {
    throw new Error('Параметр model обязателен');
  }

  let resolvedModelPath = requestedModel;

  try {
    resolvedModelPath = path.resolve(requestedModel);
    const configJsonPath = path.join(resolvedModelPath, 'config.json');

    if (!fs.existsSync(resolvedModelPath)) {
      throw new Error(`Директория модели не найдена: ${resolvedModelPath}`);
    }

    if (!fs.existsSync(configJsonPath)) {
      throw new Error(
        `Файл config.json отсутствует в директории модели: ${resolvedModelPath}\n` +
        `vLLM / transformers не смогут загрузить модель без этого файла.`
      );
    }

    logger.info('Путь к модели проверен и нормализован', {
      original: requestedModel,
      resolved: resolvedModelPath,
      configExists: true,
    });
  } catch (err) {
    logger.error('Ошибка проверки пути к модели', {
      requestedModel,
      error: err.message,
    });
    throw err;
  }

  const modelCfg = resolveModelConfig(resolvedModelPath);

  // ──────────────────────────────────────────────
  // 2. Определение количества GPU
  // ──────────────────────────────────────────────
  const { getGpuInfo } = require('../utils/gpu_info');
  const gpuInfo = await getGpuInfo().catch(() => []);
  const numGpus = gpuInfo.length || 1;

  // ──────────────────────────────────────────────
  // 3. Сборка финальных параметров
  // ──────────────────────────────────────────────
  const merged = {
    model: resolvedModelPath,  // ← исправленный абсолютный путь
    port: Number(params.port ?? inf.port ?? CONFIG.vllmPort),
    maxModelLen: resolveMaxModelLen(params, inf, modelCfg.detected),
    gpuMemoryUtilization: Number(params.gpuMemoryUtilization ?? inf.gpuMemoryUtilization ?? 0.9),
    tensorParallelSize: Number(params.tensorParallelSize ?? inf.tensorParallelSize ?? numGpus),
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

  // ──────────────────────────────────────────────
  // 4. Выбор провайдера
  // ──────────────────────────────────────────────
  if (!fs.existsSync(CONFIG.pythonBin)) {
    throw new Error(`Python бинарник не найден: ${CONFIG.pythonBin}`);
  }

  const { provider, compatibility, capabilities } = await providers.resolveProvider(
    requestedProviderId,
    modelCfg.detected
  );

  logger.info('Провайдер инференса выбран', {
    requested: requestedProviderId,
    resolved: provider.id,
    modelPath: model,
    compatibility,
    capabilities,
  });

  // ──────────────────────────────────────────────
  // 5. Очистка и подготовка
  // ──────────────────────────────────────────────
  await clearGpuMemory({ types: ['runtime'] });

  const runtime = await getRuntime();
  if (runtime.inference?.pid && isPidRunning(runtime.inference.pid)) {
    logger.info('Остановка существующего runtime перед новым запуском');
    await stopRuntime();
  }

  await fsp.mkdir(CONFIG.logsDir, { recursive: true });
  await fsp.mkdir(CONFIG.trainingConfigsDir, { recursive: true });

  // ──────────────────────────────────────────────
  // 6. Запуск провайдера
  // ──────────────────────────────────────────────
  let pid;
  try {
    pid = await provider.start({
      ...merged,
      modelConfigPath: modelCfg.configPath,
    });
  } catch (err) {
    logger.error('Не удалось запустить провайдер инференса', {
      provider: provider.id,
      modelPath: model,
      error: err.message,
      stack: err.stack?.split('\n').slice(0, 6).join('\n'),
    });
    throw err;
  }

  await registerManagedProcess({
    pid,
    type: 'runtime',
    label: `runtime:${provider.id}:${port}`,
    meta: {
      provider: provider.id,
      model,
      port,
      baseModel,
      activeModelId,
      activeLoraId,
      logFile: CONFIG.vllmLogFile,
    },
  });

  await fsp.writeFile(CONFIG.vllmPidFile, String(pid), 'utf8').catch(() => {});

  // ──────────────────────────────────────────────
  // 7. Ожидание готовности (health check)
  // ──────────────────────────────────────────────
  let healthy = false;
  try {
    for (let i = 0; i < 120; i++) {
      const h = await provider.health({ port });
      if (h.ok) {
        healthy = true;
        break;
      }

      if (!isPidRunning(pid)) {
        const logs = await readText(CONFIG.vllmLogFile, '');
        const lastLines = logs.split('\n').slice(-60).join('\n');
        throw new Error(
          `Процесс провайдера завершился во время запуска.\nПоследние логи:\n${lastLines}`
        );
      }

      await sleep(1000);
    }

    if (!healthy) {
      throw new Error('Провайдер не стал доступен в течение 120 секунд');
    }
  } catch (err) {
    logger.error('Ошибка ожидания готовности runtime', { error: err.message });
    await provider.stop({ pid }).catch(() => {});
    await unregisterManagedProcess(pid).catch(() => {});
    await removeFile(CONFIG.vllmPidFile).catch(() => {});

    const isOom = /out of memory/i.test(String(err));
    if (isOom) {
      if (merged.maxModelLen > 2048) {
        logger.warn('OOM → повторный запуск с уменьшенным maxModelLen=2048');
        return startRuntime({ ...params, maxModelLen: 2048 });
      }
      if (merged.gpuMemoryUtilization > 0.7) {
        logger.warn('OOM → повторный запуск с gpuMemoryUtilization=0.7');
        return startRuntime({ ...params, gpuMemoryUtilization: 0.7 });
      }
    }

    throw err;
  }

  // ──────────────────────────────────────────────
  // 8. Сохранение начального состояния
  // ──────────────────────────────────────────────
  const nextInference = {
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
    capabilities,
    probe: {
      ok: false,
      status: 'checking',
      checkedAt: nowIso(),
      error: null,
    },
  };

  await saveRuntime({ inference: nextInference });

  // ──────────────────────────────────────────────
  // 9. Проверка работоспособности модели (probe)
  // ──────────────────────────────────────────────
  logger.info('Выполняется проверка модели (probe)...', { provider: provider.id });

  const probeResult = await provider.probe(nextInference).catch((err) => ({
    ok: false,
    error: err.message,
  }));

  const finalInference = {
    ...nextInference,
    probe: {
      ok: probeResult.ok,
      status: probeResult.ok ? 'success' : 'failed',
      checkedAt: nowIso(),
      error: probeResult.error || null,
    },
  };

  await saveRuntime({ inference: finalInference });

  if (!probeResult.ok) {
    logger.warn('Проверка модели (probe) не прошла после запуска', {
      provider: provider.id,
      error: probeResult.error,
    });

    await provider.stop(finalInference).catch(() => {});
    await unregisterManagedProcess(pid).catch(() => {});
    await removeFile(CONFIG.vllmPidFile).catch(() => {});

    const failedState = buildStoppedInferenceState(settings, {
      providerRequested: requestedProviderId,
      providerResolved: provider.id,
      compatibilityRisk: compatibility.risk,
      compatibilityWarning: compatibility.warning || null,
      capabilities,
      probe: finalInference.probe,
    });

    await saveRuntime({ inference: failedState });
    emitEvent('runtime_stopped', failedState);

    throw new Error(`Проверка модели не прошла: ${probeResult.error || 'неизвестная ошибка'}`);
  }

  emitEvent('runtime_started', finalInference);
  logger.info('Runtime успешно запущен', {
    provider: provider.id,
    probe: finalInference.probe,
    modelPath: model,
  });

  return finalInference;
}

/**
 * Остановка runtime
 */
async function stopRuntime() {
  const runtime = await getRuntime();
  const state = runtime.inference;
  const pid = state?.pid;
  const providerId = state?.providerResolved;

  if (pid && isPidRunning(pid)) {
    const provider = providers.PROVIDERS[providerId] || providers.PROVIDERS.vllm;
    logger.info('Остановка runtime', { provider: provider.id, pid });
    await provider.stop(state).catch((err) => {
      logger.warn('Ошибка при остановке провайдера', { error: err.message });
    });
  }

  if (pid) {
    await unregisterManagedProcess(pid).catch(() => {});
  }

  await removeFile(CONFIG.vllmPidFile).catch(() => {});

  const settings = await getSettings();
  const stoppedState = buildStoppedInferenceState(settings);

  await saveRuntime({ inference: stoppedState });
  emitEvent('runtime_stopped', stoppedState);

  logger.info('Runtime остановлен');
  return stoppedState;
}

async function getRuntimeHealth(port) {
  const runtime = await getRuntime();
  const targetPort = port || runtime.inference?.port || CONFIG.vllmPort;
  const providerId = runtime.inference?.providerResolved || 'vllm';
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
  startRuntime,
  stopRuntime,
  getRuntimeHealth,
  startVllmRuntime: startRuntime,   // алиас для совместимости
  stopVllmRuntime: stopRuntime,     // алиас для совместимости
};