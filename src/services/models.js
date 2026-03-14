const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { CONFIG } = require('../config');
const { uid, nowIso } = require('../utils/ids');
const { addModel, getModels, getModelById, removeModel, upsertModel } = require('./state');
const { emitEvent } = require('./events');
const { readText } = require('../utils/fs');

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

  return { ok: true };
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
};