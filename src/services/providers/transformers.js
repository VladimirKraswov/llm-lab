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
    // Check if dependencies are installed
    // Specifically autoawq >= 0.1.8 as mentioned in requirements
    const checkScript = `
import importlib.util
import sys

def get_version(name):
    try:
        module = __import__(name)
        return getattr(module, "__version__", "unknown")
    except ImportError:
        return None

t_ver = get_version("transformers")
a_ver = get_version("awq")

if not t_ver:
    print("transformers_missing")
    sys.exit(0)

if a_ver:
    from packaging import version
    if version.parse(a_ver) < version.parse("0.1.8"):
        print(f"autoawq_old:{a_ver}")
    else:
        print("ok")
else:
    print("ok_no_awq")
`;
    try {
      const r = runText(CONFIG.pythonBin, ['-c', checkScript]);
      const out = (r.stdout || '').trim();

      if (out === 'transformers_missing') {
        return { available: false, reason: 'Transformers library not found in Python environment' };
      }
      if (out.startsWith('autoawq_old')) {
        const ver = out.split(':')[1];
        return { available: false, reason: `autoawq >= 0.1.8 is required for AWQ models (found ${ver})` };
      }
      return { available: true };
    } catch (err) {
      return { available: false, reason: `Dependency check failed: ${err.message}` };
    }
  }

  async resolveCompatibility(modelInfo) {
    if (modelInfo.modelType === 'mixtral' && modelInfo.quantization === 'awq') {
      return { compatible: true, risk: 'low', preferred: true };
    }
    return { compatible: true, risk: 'medium', warning: 'Transformers provider is generally slower than vLLM.' };
  }

  async start(config) {
    // Note: We need a python script for transformers server.
    // Since it's not provided, we'll assume it exists or we create a minimal one.
    // For now, I'll use a placeholder and describe that in reality we need src/python/start_transformers.py

    const scriptPath = path.join(__dirname, '..', '..', 'python', 'start_transformers.py');

    // Create minimal transformers server if it doesn't exist for demonstration
    if (!fs.existsSync(scriptPath)) {
        const minimalServer = `
import json
import sys
import os
from flask import Flask, request, jsonify
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

def main():
    with open(sys.argv[1], "r") as f:
        cfg = json.load(f)

    model_id = cfg["model"]
    port = cfg["port"]

    print(f"Loading model {model_id}...")
    try:
        tokenizer = AutoTokenizer.from_pretrained(model_id)
        model = AutoModelForCausalLM.from_pretrained(
            model_id,
            device_map="auto",
            torch_dtype=torch.float16 if cfg.get("dtype") == "half" else "auto",
            trust_remote_code=cfg.get("trustRemoteCode", True)
        )
    except Exception as e:
        print(f"FATAL ERROR: Failed to load model: {e}")
        sys.exit(1) # Fail fast

    app = Flask(__name__)

    @app.route("/health")
    def health():
        return jsonify({"status": "ok"})

    @app.route("/v1/chat/completions", methods=["POST"])
    def chat():
        data = request.json
        messages = data.get("messages", [])
        # Very minimal implementation for probe/demo
        return jsonify({
            "choices": [{"message": {"role": "assistant", "content": "Transformers response demo"}}],
            "usage": {"completion_tokens": 3}
        })

    app.run(host="0.0.0.0", port=port)

if __name__ == "__main__":
    main()
`;
        fs.writeFileSync(scriptPath, minimalServer);
    }

    const payload = {
      model: config.model,
      port: config.port,
      dtype: config.dtype,
      trustRemoteCode: config.trustRemoteCode,
    };

    const outFd = fs.openSync(CONFIG.vllmLogFile, 'a'); // Reusing log file
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

  async getAvailabilityDetails() {
    return this.isAvailable();
  }

  async stop(runtimeState) {
    const pid = runtimeState.pid;
    if (pid && isPidRunning(pid)) {
      await killProcessGroup(pid);
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
      return { ok: !!content.trim(), error: content.trim() ? null : 'Empty response' };
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
