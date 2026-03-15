const fs = require('fs');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const { CONFIG } = require('../config');
const { nowIso } = require('../utils/ids');
const { runText, isPidRunning, killProcessGroup } = require('../utils/proc');
const { getRuntime, saveRuntime, getSettings } = require('./state');
const { emitEvent } = require('./events');
const logger = require('../utils/logger');
const { clearGpuMemory } = require('../utils/gpu');
const { readText } = require('../utils/fs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function validateInferenceParams(params = {}) {
  if (
    params.gpuMemoryUtilization !== undefined &&
    (typeof params.gpuMemoryUtilization !== 'number' ||
      params.gpuMemoryUtilization < 0 ||
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

async function startVllmRuntime(params = {}) {
  validateInferenceParams(params);

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
  } = params;

  if (!model) {
    throw new Error('model is required');
  }

  if (!fs.existsSync(CONFIG.vllmBin)) {
    throw new Error(`vLLM binary not found: ${CONFIG.vllmBin}`);
  }

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

  const args = [
    'serve',
    model,
    '--host',
    '0.0.0.0',
    '--port',
    String(port),
    '--gpu-memory-utilization',
    String(gpuMemoryUtilization),
    '--tensor-parallel-size',
    String(tensorParallelSize),
    '--max-model-len',
    String(maxModelLen),
    '--max-num-seqs',
    String(maxNumSeqs),
    '--swap-space',
    String(swapSpace),
    '--dtype',
    String(dtype || 'auto'),
  ];

  if (quantization) {
    args.push('--quantization', String(quantization));
  }

  if (trustRemoteCode) {
    args.push('--trust-remote-code');
  }

  if (enforceEager) {
    args.push('--enforce-eager');
  }

  if (kvCacheDtype && kvCacheDtype !== 'auto') {
    args.push('--kv-cache-dtype', String(kvCacheDtype));
  }

  if (loraPath && loraName) {
    args.push('--enable-lora');
    args.push('--lora-modules');
    args.push(`${loraName}=${loraPath}`);
  }

  fs.mkdirSync(CONFIG.logsDir, { recursive: true });

  const outFd = fs.openSync(CONFIG.vllmLogFile, 'a');
  const child = spawn(CONFIG.vllmBin, args, {
    cwd: CONFIG.workspace,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  child.unref();
  await fsp.writeFile(CONFIG.vllmPidFile, String(child.pid), 'utf8');

  let started = false;

  for (let i = 0; i < 120; i += 1) {
    const r = runText('curl', ['-fsS', '--max-time', '2', `http://127.0.0.1:${port}/health`]);

    if (r.ok) {
      started = true;
      break;
    }

    if (!isPidRunning(child.pid)) {
      logger.error('vLLM exited during startup', {
        model,
        port,
        logFile: CONFIG.vllmLogFile,
      });
      throw new Error(`vLLM exited during startup; check ${CONFIG.vllmLogFile}`);
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
    });
    throw new Error(`vLLM startup timed out. Last logs: ${lastLines || 'None'}`);
  }

  const settings = await getSettings();

  const next = {
    vllm: {
      pid: child.pid,
      model,
      startedAt: nowIso(),
      port,
      logFile: CONFIG.vllmLogFile,
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
  });

  return next.vllm;
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

  const settings = await getSettings();

  const next = {
    vllm: {
      pid: null,
      model: null,
      startedAt: null,
      port: CONFIG.vllmPort,
      logFile: CONFIG.vllmLogFile,
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
  const targetPort = port || CONFIG.vllmPort;
  const r = runText('curl', ['-fsS', '--max-time', '2', `http://127.0.0.1:${targetPort}/health`]);

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