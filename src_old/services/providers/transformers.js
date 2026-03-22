const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../../config');
const { runText, isPidRunning, killProcessGroup } = require('../../utils/proc');
const { spawnPythonJsonScript } = require('../../utils/python-runner');

class TransformersProvider {
  constructor() {
    this.id = 'transformers';
    this.label = 'Transformers';
    this.description = 'Experimental fallback inference using HuggingFace Transformers';
    this.capabilities = {
      experimental: true,
      supportsStreaming: false,
      supportsLora: true,
      supportsAwq: true,
    };
  }

  async isAvailable() {
    if (!fs.existsSync(CONFIG.transformersPythonBin)) {
      return {
        available: false,
        reason: `Transformers Python not found at ${CONFIG.transformersPythonBin}`,
      };
    }

    const checkScript = `
import importlib
import sys
required = ["transformers", "torch", "flask", "peft"]
missing = []
for name in required:
    try:
        importlib.import_module(name)
    except Exception as e:
        missing.append(f"{name} ({e})")
if missing:
    print("missing:" + " | ".join(missing))
else:
    print("ok")
`;

    try {
      const r = runText(CONFIG.transformersPythonBin, ['-c', checkScript]);
      const out = (r.stdout || '').trim();
      if (out.startsWith('missing:')) {
        return { available: false, reason: out.slice('missing:'.length) };
      }
      return { available: true };
    } catch (err) {
      return { available: false, reason: `Dependency check failed: ${err.message}` };
    }
  }

  async getAvailabilityDetails() {
    return this.isAvailable();
  }

  async resolveCompatibility(modelInfo) {
    if (modelInfo.quantization === 'awq') {
      return {
        compatible: true,
        risk: 'high',
        warning: 'Transformers AWQ path is experimental and may fail because of AutoAWQ/Triton compatibility.',
      };
    }

    return {
      compatible: true,
      risk: 'medium',
      warning: 'Transformers provider is experimental and intended as fallback/debug path.',
    };
  }

  async start(config) {
    const scriptPath = path.join(__dirname, '..', '..', 'python', 'start_transformers.py');

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Transformers provider script not found at ${scriptPath}`);
    }

    const payload = {
      model: config.model,
      port: config.port,
      dtype: config.dtype,
      trustRemoteCode: config.trustRemoteCode,
      loraPath: config.loraPath,
    };

    const outFd = fs.openSync(CONFIG.vllmLogFile, 'a');
    const { child } = await spawnPythonJsonScript({
      pythonBin: CONFIG.transformersPythonBin,
      scriptPath,
      payload,
      cwd: CONFIG.workspace,
      detached: true,
      stdio: ['ignore', outFd, outFd],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      configDir: CONFIG.trainingConfigsDir,
      configPrefix: `transformers-${config.port}`,
      logLabel: `runtime-transformers:${config.port}`,
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
          stream: false,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return { ok: false, error: text || `HTTP ${response.status}` };
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
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
      body: JSON.stringify({ ...payload, stream: false }),
    });
  }
}

module.exports = new TransformersProvider();