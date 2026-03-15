const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { CONFIG } = require('../config');
const { nowIso } = require('../utils/ids');
const { runText, isPidRunning, killProcessGroup } = require('../utils/proc');
const { getRuntime, saveRuntime, getSettings } = require('./state');
const { emitEvent } = require('./events');
const logger = require('../utils/logger');
const { clearGpuMemory } = require('../utils/gpu');
const { readText, removeFile } = require('../utils/fs');
const { spawnPythonJsonScript } = require('../utils/python-runner');

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
  };

  validateInferenceParams(merged);

  const {
    model,
    port,
    maxModelLen,
    gpuMemoryUtilization,
    tensorParallelSize,
    baseModel = null,
    activeModelId = null,
    activeModelName = null,
    activeLoraId = null,
    activeLoraName = null,
    loraPath = null,
    loraName = null,
    quantization = null,
    dtype = 'auto',
    trustRemoteCode = true,
    enforceEager = false,
    kvCacheDtype = 'auto',
    maxNumSeqs = 256,
    swapSpace = 4,
  } = merged;

  if (!fs.existsSync(CONFIG.pythonBin)) {
    throw new Error(`Python binary not found: ${CONFIG.pythonBin}`);
  }

  if (!fs.existsSync(CONFIG.vllmBin)) {
    throw new Error(`vLLM binary not found: ${CONFIG.vllmBin}`);
  }

  logger.info('Resolved vLLM launch settings', {
    model,
    modelConfigPath: modelCfg.configPath,
    detectedQuantization: modelCfg.detected.quantization,
    detectedDtype: modelCfg.detected.dtype,
    detectedMaxModelLen: modelCfg.detected.maxModelLen,
    quantization,
    dtype,
    maxModelLen,
    maxNumSeqs,
    gpuMemoryUtilization,
    tensorParallelSize,
  });

  logger.info('Starting vLLM runtime', {
    model,
    activeModelName,
    activeLoraName,
    loraPath,
    port,
  });

  await clearGpuMemory();

  const runtime = await getRuntime();
  if (runtime.vllm?.pid && isPidRunning(runtime.vllm.pid)) {
    await stopVllmRuntime();
  }

  fs.mkdirSync(CONFIG.logsDir, { recursive: true });
  fs.mkdirSync(CONFIG.trainingConfigsDir, { recursive: true });

  let outFd;
  try {
    outFd = fs.openSync(CONFIG.vllmLogFile, 'a');

    const scriptPath = path.join(__dirname, '..', 'python', 'start_vllm.py');
    const payload = {
      vllmBin: CONFIG.vllmBin,
      model,
      host: '0.0.0.0',
      port,
      gpuMemoryUtilization,
      tensorParallelSize,
      maxModelLen,
      maxNumSeqs,
      swapSpace,
      dtype,
      quantization,
      trustRemoteCode,
      enforceEager,
      kvCacheDtype,
      loraPath,
      loraName,
      cwd: CONFIG.workspace,
      pidFile: CONFIG.vllmPidFile,
      logFile: CONFIG.vllmLogFile,
      modelConfigPath: modelCfg.configPath,
    };

    const { child, configPath } = await spawnPythonJsonScript({
      pythonBin: CONFIG.pythonBin,
      scriptPath,
      payload,
      cwd: CONFIG.workspace,
      detached: true,
      stdio: ['ignore', outFd, outFd],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      configDir: CONFIG.trainingConfigsDir,
      configPrefix: `vllm-${port}`,
      logLabel: `runtime-vllm:${port}`,
    });

    child.unref();
    await fsp.writeFile(CONFIG.vllmPidFile, String(child.pid), 'utf8');

    let started = false;

    try {
      for (let i = 0; i < 120; i += 1) {
        const r = runText('curl', [
          '-fsS',
          '--max-time',
          '2',
          `http://127.0.0.1:${port}/health`,
        ]);

        if (r.ok) {
          started = true;
          break;
        }

        if (!isPidRunning(child.pid)) {
          const logs = await readText(CONFIG.vllmLogFile, '');
          const lastLines = logs.split('\n').slice(-50).join('\n');

          logger.error('vLLM exited during startup', {
            model,
            port,
            logFile: CONFIG.vllmLogFile,
            configPath,
            lastLines,
          });
          throw new Error(`vLLM exited during startup. Last logs:\n${lastLines || 'No logs available'}`);
        }

        await sleep(1000);
      }

      if (!started) {
        await killProcessGroup(child.pid, 'SIGKILL');
        const logs = await readText(CONFIG.vllmLogFile, '');
        const lastLines = logs.split('\n').slice(-30).join('\n');
        logger.error('vLLM did not become healthy within timeout', {
          model,
          port,
          lastLines,
          configPath,
        });
        throw new Error(`vLLM startup timed out. Last logs: ${lastLines || 'None'}`);
      }
    } catch (err) {
      await removeFile(CONFIG.vllmPidFile).catch(() => {});
      throw err;
    }

    const next = {
      vllm: {
        pid: child.pid,
        model,
        startedAt: nowIso(),
        port,
        logFile: CONFIG.vllmLogFile,
        configPath,
        baseModel: baseModel || settings.baseModel,
        activeModelId,
        activeModelName,
        activeLoraId,
        activeLoraName,
      },
    };

    await saveRuntime(next);
    emitEvent('runtime_started', next.vllm);

    logger.info('vLLM runtime started', {
      pid: child.pid,
      model,
      port,
      activeModelName,
      activeLoraName,
      configPath,
    });

    return next.vllm;
  } finally {
    if (typeof outFd === 'number') {
      try {
        fs.closeSync(outFd);
      } catch {
        // ignore
      }
    }
  }
}

async function stopVllmRuntime() {
  const runtime = await getRuntime();
  const pid = runtime.vllm?.pid;

  if (pid && isPidRunning(pid)) {
    await killProcessGroup(pid);

    for (let i = 0; i < 20; i += 1) {
      if (!isPidRunning(pid)) break;
      await sleep(500);
    }

    if (isPidRunning(pid)) {
      await killProcessGroup(pid, 'SIGKILL');
    }
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
    },
  };

  await saveRuntime(next);
  emitEvent('runtime_stopped', next.vllm);
  logger.info('vLLM runtime stopped');

  return next.vllm;
}

async function getRuntimeHealth(port) {
  const runtime = await getRuntime();
  const targetPort = port || runtime.vllm?.port || CONFIG.vllmPort;

  const r = runText('curl', [
    '-fsS',
    '--max-time',
    '2',
    `http://127.0.0.1:${targetPort}/health`,
  ]);

  return {
    ok: r.ok,
    port: targetPort,
    raw: r.ok ? r.stdout : (r.stderr || r.stdout || null),
  };
}

module.exports = {
  startVllmRuntime,
  stopVllmRuntime,
  getRuntimeHealth,
};