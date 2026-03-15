const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { CONFIG } = require('../config');
const { uid, nowIso } = require('../utils/ids');
const { addModel, getModels, getModelById, removeModel, upsertModel } = require('./state');
const { emitEvent } = require('./events');
const { readText } = require('../utils/fs');
const logger = require('../utils/logger');
const { getModelMetadata } = require('../utils/model-meta');

function safeSlug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function downloadModel({ repoId, name }) {
  if (!repoId) throw new Error('repoId is required');

  const existing = (await getModels()).find((x) => x.repoId === repoId && x.status !== 'deleted');
  if (existing) return existing;

  const modelId = uid('model');
  const slug = safeSlug(name || repoId.split('/').pop() || modelId);
  const modelPath = path.join(CONFIG.modelsDir, `${slug}-${modelId}`);
  const logFile = path.join(CONFIG.logsDir, `${modelId}.log`);

  const item = await addModel({
    id: modelId,
    name: name || repoId.split('/').pop() || modelId,
    repoId,
    createdAt: nowIso(),
    status: 'downloading',
    path: modelPath,
    logFile,
    pid: null,
    error: null,
  });

  emitEvent('model_updated', item);

  fs.mkdirSync(CONFIG.modelsDir, { recursive: true });
  fs.mkdirSync(CONFIG.logsDir, { recursive: true });

  const py = `
import os
from huggingface_hub import snapshot_download

repo_id = ${JSON.stringify(repoId)}
local_dir = ${JSON.stringify(modelPath)}
os.makedirs(local_dir, exist_ok=True)

snapshot_download(
    repo_id=repo_id,
    local_dir=local_dir,
    local_dir_use_symlinks=False,
    resume_download=True,
)
print(local_dir)
`.trim();

  const outFd = fs.openSync(logFile, 'a');
  const child = spawn(CONFIG.pythonBin, ['-u', '-c', py], {
    cwd: CONFIG.workspace,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  child.unref();

  const running = await upsertModel({
    ...item,
    pid: child.pid,
  });
  emitEvent('model_updated', running);

  child.on('exit', async (code) => {
    const next = await upsertModel({
      ...running,
      status: code === 0 ? 'ready' : 'failed',
      error: code === 0 ? null : `download exited with code ${code}`,
      pid: null,
    });
    emitEvent('model_updated', next);
    if (code === 0) {
      const meta = getModelMetadata(next.path);
      const withMeta = await upsertModel({
        ...next,
        ...meta
      });
      emitEvent('model_updated', withMeta);
      logger.info(`Model downloaded successfully: ${next.name}`, { modelId: next.id });
    } else {
      logger.error(`Model download failed: ${next.name}`, { modelId: next.id, error: next.error });
    }
  });

  child.on('error', async (err) => {
    const next = await upsertModel({
      ...running,
      status: 'failed',
      error: String(err.message || err),
      pid: null,
    });
    emitEvent('model_updated', next);
  });

  return running;
}

async function deleteModel(modelId) {
  const item = await getModelById(modelId);
  if (!item) throw new Error('model not found');

  if (item.path && fs.existsSync(item.path)) {
    fs.rmSync(item.path, { recursive: true, force: true });
  }

  await removeModel(modelId);
  emitEvent('model_deleted', { id: modelId });
  logger.info(`Model deleted: ${item.name}`, { modelId });

  return { ok: true };
}

async function quantizeModel({ modelId, method, name }) {
  const source = await getModelById(modelId);
  if (!source) throw new Error('source model not found');
  if (source.status !== 'ready') throw new Error('source model is not ready');

  const newId = uid('model');
  const slug = safeSlug(name || `${source.name}-${method}`);
  const modelPath = path.join(CONFIG.modelsDir, `${slug}-${newId}`);
  const logFile = path.join(CONFIG.logsDir, `${newId}.log`);

  const item = await addModel({
    id: newId,
    name: name || `${source.name} (${method})`,
    repoId: `local/quantized/${source.id}`,
    createdAt: nowIso(),
    status: 'building',
    path: modelPath,
    logFile,
    pid: null,
    error: null,
    quantization: method,
    sourceModelId: modelId,
  });

  emitEvent('model_updated', item);
  fs.mkdirSync(modelPath, { recursive: true });

  let py = '';
  if (method === 'awq') {
    py = `
import torch
from awq import AutoAWQForCausalLM
from transformers import AutoTokenizer

model_path = ${JSON.stringify(source.path)}
quant_path = ${JSON.stringify(modelPath)}

quant_config = { "zero_point": True, "q_group_size": 128, "w_bit": 4, "version": "GEMM" }

model = AutoAWQForCausalLM.from_pretrained(model_path)
tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)

model.quantize(tokenizer, quant_config=quant_config)
model.save_quantized(quant_path)
tokenizer.save_pretrained(quant_path)
`.trim();
  } else {
    // Default to BitsAndBytes 4-bit (though usually it's used on the fly, we can "save" it if unsloth/transformers allows)
    throw new Error(`Quantization method ${method} not implemented in this version`);
  }

  const outFd = fs.openSync(logFile, 'a');
  const child = spawn(CONFIG.pythonBin, ['-u', '-c', py], {
    cwd: CONFIG.workspace,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  child.unref();

  const running = await upsertModel({ ...item, pid: child.pid });
  emitEvent('model_updated', running);

  child.on('exit', async (code) => {
    const isOk = code === 0;
    const meta = isOk ? getModelMetadata(modelPath) : {};
    const next = await upsertModel({
      ...running,
      ...meta,
      status: isOk ? 'ready' : 'failed',
      error: isOk ? null : `quantization exited with code ${code}`,
      pid: null,
    });
    emitEvent('model_updated', next);
  });

  return running;
}

async function getModelLogs(id, tail = 200) {
  const item = await getModelById(id);
  if (!item) throw new Error('model not found');

  const text = await readText(item.logFile, '');
  const lines = text.split('\n');
  return {
    id: item.id,
    logFile: item.logFile,
    content: lines.slice(-tail).join('\n'),
  };
}

module.exports = {
  downloadModel,
  deleteModel,
  getModelLogs,
  quantizeModel,
};