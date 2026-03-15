const path = require('path');
require('dotenv').config();

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '*') return '*';

  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return '*';
  }
}

const CONFIG = {
  host: process.env.SVC_HOST || '0.0.0.0',
  port: toNumber(process.env.SVC_PORT, 8787),
  workspace: process.env.WORKSPACE || '/opt/deepseek-workspace',
  mlEnv: process.env.ML_ENV || '/opt/deepseek-workspace/environments/ml_env',
  openWebUiPort: toNumber(process.env.OPENWEBUI_PORT, 3000),
  vllmPort: toNumber(process.env.VLLM_PORT, 8000),
  defaultBaseModel: process.env.DEFAULT_BASE_MODEL || 'Qwen/Qwen2.5-7B-Instruct',
  maxJsonMb: toNumber(process.env.MAX_JSON_MB, 25),
  webUiOrigin: normalizeOrigin(process.env.WEB_UI_ORIGIN || '*'),
};

CONFIG.stateDir = path.join(CONFIG.workspace, '.llm-lab');
CONFIG.modelsDir = path.join(CONFIG.workspace, 'models', 'base');
CONFIG.datasetsDir = path.join(CONFIG.workspace, 'data', 'processed');
CONFIG.rawDatasetsDir = path.join(CONFIG.workspace, 'data', 'raw');
CONFIG.trainingConfigsDir = path.join(CONFIG.workspace, 'training', 'configs');
CONFIG.trainingOutputsDir = path.join(CONFIG.workspace, 'training', 'outputs');
CONFIG.mergedModelsDir = path.join(CONFIG.workspace, 'exports', 'merged');
CONFIG.packagesDir = path.join(CONFIG.workspace, 'exports', 'packages');
CONFIG.logsDir = path.join(CONFIG.workspace, 'logs');

CONFIG.jobsFile = path.join(CONFIG.stateDir, 'jobs.json');
CONFIG.settingsFile = path.join(CONFIG.stateDir, 'settings.json');
CONFIG.datasetsFile = path.join(CONFIG.stateDir, 'datasets.json');
CONFIG.runtimeFile = path.join(CONFIG.stateDir, 'runtime.json');
CONFIG.modelsFile = path.join(CONFIG.stateDir, 'models.json');
CONFIG.lorasFile = path.join(CONFIG.stateDir, 'loras.json');

CONFIG.vllmPidFile = path.join(CONFIG.logsDir, 'vllm.pid');
CONFIG.vllmLogFile = path.join(CONFIG.logsDir, 'vllm.log');
CONFIG.pythonBin = path.join(CONFIG.mlEnv, 'bin', 'python');
CONFIG.vllmBin = path.join(CONFIG.mlEnv, 'bin', 'vllm');

module.exports = { CONFIG };