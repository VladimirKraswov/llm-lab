const fs = require('fs');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const { CONFIG } = require('../config');
const { nowIso } = require('../utils/ids');
const { runText, isPidRunning, killProcessGroup } = require('../utils/proc');
const { getRuntime, saveRuntime } = require('./state');
const { emitEvent } = require('./events');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startVllmRuntime({
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
}) {
  if (!fs.existsSync(CONFIG.vllmBin)) {
    throw new Error(`vLLM binary not found: ${CONFIG.vllmBin}`);
  }

  const runtime = await getRuntime();
  if (runtime.vllm?.pid && isPidRunning(runtime.vllm.pid)) {
    return runtime.vllm;
  }

  const args = [
    'serve', model,
    '--host', '0.0.0.0',
    '--port', String(port),
    '--gpu-memory-utilization', String(gpuMemoryUtilization),
    '--tensor-parallel-size', String(tensorParallelSize),
    '--max-model-len', String(maxModelLen),
  ];

  const outFd = fs.openSync(CONFIG.vllmLogFile, 'a');
  const child = spawn(CONFIG.vllmBin, args, {
    cwd: CONFIG.workspace,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });
  child.unref();
  await fsp.writeFile(CONFIG.vllmPidFile, String(child.pid), 'utf8');

  for (let i = 0; i < 120; i += 1) {
    const r = runText('curl', ['-fsS', '--max-time', '2', `http://127.0.0.1:${port}/health`]);
    if (r.ok) break;
    if (!isPidRunning(child.pid)) {
      throw new Error(`vLLM exited during startup; check ${CONFIG.vllmLogFile}`);
    }
    await sleep(1000);
  }

  const settings = await require('./state').getSettings();

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

  const settings = await require('./state').getSettings();

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
