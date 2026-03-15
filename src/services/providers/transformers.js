const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../../config');
const logger = require('../../utils/logger');
const { runText, isPidRunning, killProcessGroup } = require('../../utils/proc');
const { spawnPythonJsonScript } = require('../../utils/python-runner');

class TransformersProvider {
  constructor() {
    this.id = 'transformers';
    this.label = 'Transformers';
    this.description = 'Fallback inference using HuggingFace Transformers (Slower, but compatible with more models)';
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
from importlib.metadata import version, PackageNotFoundError

def has_module(name):
    try:
        importlib.import_module(name)
        return True, None
    except Exception as e:
        return False, str(e)

def pkg_version(name):
    try:
        return version(name)
    except PackageNotFoundError:
        return None

required = ["transformers", "torch", "flask", "peft"]
missing = []

for name in required:
    ok, err = has_module(name)
    if not ok:
        missing.append(f"{name} ({err})")

if missing:
    print("missing:" + " | ".join(missing))
    sys.exit(0)

awq_ver = pkg_version("autoawq")
if awq_ver:
    try:
        importlib.import_module("awq")
    except Exception as e:
        print("awq_import_error:" + str(e))
        sys.exit(0)
    print("ok:autoawq=" + awq_ver)
else:
    print("ok:no-autoawq")
`;

    try {
      const r = runText(CONFIG.transformersPythonBin, ['-c', checkScript]);
      const out = (r.stdout || '').trim();
      const err = (r.stderr || '').trim();

      if (out.startsWith('missing:')) {
        return { available: false, reason: out.slice('missing:'.length) };
      }

      if (out.startsWith('awq_import_error:')) {
        return {
          available: true,
          reason: `AWQ support is broken in transformers env: ${out.slice('awq_import_error:'.length)}`,
        };
      }

      if (out.startsWith('ok:')) {
        return { available: true };
      }

      return {
        available: false,
        reason: `Unexpected dependency check output: ${out || err || 'empty output'}`,
      };
    } catch (err) {
      return { available: false, reason: `Dependency check failed: ${err.message}` };
    }
  }

  async getAvailabilityDetails() {
    return this.isAvailable();
  }

  async resolveCompatibility(modelInfo) {
    if (modelInfo.modelType === 'mixtral' && modelInfo.quantization === 'awq') {
      return { compatible: true, risk: 'low', preferred: true };
    }
    return {
      compatible: true,
      risk: 'medium',
      warning: 'Transformers provider is generally slower than vLLM.',
    };
  }

  async start(config) {
    const scriptPath = path.join(__dirname, '..', '..', 'python', 'start_transformers.py');

    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Transformers provider script not found at ${scriptPath}`);
    }

    if (!fs.existsSync(CONFIG.transformersPythonBin)) {
      throw new Error(`Transformers Python not found: ${CONFIG.transformersPythonBin}`);
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
        }),
      });

      if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
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
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return response;
  }
}

module.exports = new TransformersProvider();