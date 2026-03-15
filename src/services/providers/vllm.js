const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../../config');
const { runText, isPidRunning, killProcessGroup } = require('../../utils/proc');
const { spawnPythonJsonScript } = require('../../utils/python-runner');

class VllmProvider {
  constructor() {
    this.id = 'vllm';
    this.label = 'vLLM';
    this.description = 'High-throughput serving with vLLM (Recommended for most models)';
    this.capabilities = {
      experimental: false,
      supportsStreaming: true,
      supportsLora: true,
      supportsAwq: true,
    };
  }

  async isAvailable() {
    if (!fs.existsSync(CONFIG.vllmBin)) {
      return { available: false, reason: `vLLM binary not found at ${CONFIG.vllmBin}` };
    }
    return { available: true };
  }

  async getAvailabilityDetails() {
    return this.isAvailable();
  }

  async resolveCompatibility(modelInfo) {
    if (modelInfo.modelType === 'mixtral' && modelInfo.quantization === 'awq') {
      return {
        compatible: true,
        risk: 'high',
        warning:
          'Mixtral-AWQ might return empty responses in some vLLM versions.',
      };
    }
    return { compatible: true, risk: 'low' };
  }

  async start(config) {
    const {
      model,
      port,
      maxModelLen,
      gpuMemoryUtilization,
      tensorParallelSize,
      maxNumSeqs,
      swapSpace,
      dtype,
      quantization,
      trustRemoteCode,
      enforceEager,
      kvCacheDtype,
      loraPath,
      loraName,
      modelConfigPath,
    } = config;

    const scriptPath = path.join(__dirname, '..', '..', 'python', 'start_vllm.py');
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
      modelConfigPath,
    };

    const outFd = fs.openSync(CONFIG.vllmLogFile, 'a');
    const { child } = await spawnPythonJsonScript({
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
    return child.pid;
  }

  async stop(runtimeState) {
    const pid = runtimeState.pid;
    if (pid && isPidRunning(pid)) {
      await killProcessGroup(pid);
      for (let i = 0; i < 20; i++) {
        if (!isPidRunning(pid)) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (isPidRunning(pid)) {
        await killProcessGroup(pid, 'SIGKILL');
      }
    }
  }

  async health(runtimeState) {
    const port = runtimeState.port;
    const r = runText('curl', ['-fsS', '--max-time', '2', `http://127.0.0.1:${port}/health`]);
    return { ok: r.ok, status: r.stdout || r.stderr };
  }

  async probe(runtimeState) {
    const { port, model } = runtimeState;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'test' }],
          max_tokens: 5,
        }),
      });

      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const tokens = data.usage?.completion_tokens || 0;

      if (tokens > 0 && !content.trim()) {
        return { ok: false, error: 'Empty response despite token generation' };
      }
      if (!content.trim()) {
        return { ok: false, error: 'Empty response from model' };
      }

      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async chat(runtimeState, payload) {
    const port = runtimeState.port;
    return fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}

module.exports = new VllmProvider();