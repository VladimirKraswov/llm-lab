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
    const checkScript = `
import importlib.util
import sys

def get_version(name):
    try:
        module = importlib.import_module(name)
        return getattr(module, "__version__", "unknown")
    except ImportError:
        return None

packages = ["transformers", "torch", "flask", "peft"]
missing = [p for p in packages if get_version(p) is None]

if missing:
    print(f"missing:{','.join(missing)}")
    sys.exit(0)

a_ver = get_version("awq")
if a_ver:
    from packaging import version
    if version.parse(a_ver) < version.parse("0.1.8"):
        print(f"autoawq_old:{a_ver}")
    else:
        print("ok")
else:
    print("ok")
`;
    try {
      const r = runText(CONFIG.pythonBin, ['-c', checkScript]);
      const out = (r.stdout || '').trim();

      if (out.startsWith('missing:')) {
        const pkgs = out.split(':')[1];
        return { available: false, reason: `Missing required Python packages: ${pkgs}` };
      }
      if (out.startsWith('autoawq_old')) {
        const ver = out.split(':')[1];
        return { available: false, reason: `autoawq >= 0.1.8 is required for AWQ models (found ${ver})` };
      }
      if (out === 'ok') {
        return { available: true };
      }
      return { available: false, reason: `Unexpected dependency check output: ${out}` };
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
    return { compatible: true, risk: 'medium', warning: 'Transformers provider is generally slower than vLLM.' };
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
      pythonBin: CONFIG.pythonBin,
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
        await new Promise(r => setTimeout(r, 500));
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
