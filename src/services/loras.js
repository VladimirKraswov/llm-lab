const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { CONFIG } = require('../config');
const { uid, nowIso } = require('../utils/ids');
const {
  getJobs,
  getLoraByJobId,
  addLora,
  getLoraById,
  getModelById,
  upsertLora,
} = require('./state');
const { isPidRunning } = require('../utils/proc');
const { emitEvent } = require('./events');
const logger = require('../utils/logger');

async function registerLoraFromJob(jobId, customName = null) {
  const existing = await getLoraByJobId(jobId);
  if (existing) return existing;

  const jobs = await getJobs();
  const job = jobs.find((x) => x.id === jobId);
  if (!job) throw new Error('job not found');
  if (job.status !== 'completed') throw new Error('job is not completed');

  let baseModelName = job.baseModel;
  let baseModelId = job.modelId || null;

  if (baseModelId) {
    const model = await getModelById(baseModelId);
    if (model) baseModelName = model.name;
  }

  const item = await addLora({
    id: uid('lora'),
    name: (customName || job.name || job.id).trim(),
    jobId: job.id,
    baseModelId,
    baseModelName,
    baseModelRef: job.baseModel,
    adapterPath: job.outputDir,
    mergedPath: null,
    packagePath: null,
    createdAt: nowIso(),
    status: 'ready',
    mergeStatus: 'not_built',
    packageStatus: 'not_built',
    error: null,
  });

  emitEvent('lora_created', item);
  logger.info(`LoRA registered from job: ${item.name}`, { loraId: item.id, jobId });
  return item;
}

async function buildMergedLora(loraId) {
  const item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');
  if (item.mergeStatus === 'building' && item.mergePid && isPidRunning(item.mergePid)) {
    return item;
  }

  const mergedPath = path.join(CONFIG.mergedModelsDir, `${item.id}-merged`);
  fs.mkdirSync(CONFIG.mergedModelsDir, { recursive: true });

  const next0 = await upsertLora({
    ...item,
    mergeStatus: 'building',
    mergedPath,
    mergePid: null,
    error: null,
  });
  emitEvent('lora_updated', next0);

  const py = `
import os
import sys
from peft import AutoPeftModelForCausalLM
from transformers import AutoTokenizer

adapter_path = ${JSON.stringify(item.adapterPath)}
output_dir = ${JSON.stringify(mergedPath)}

try:
    os.makedirs(output_dir, exist_ok=True)

    import torch
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = AutoPeftModelForCausalLM.from_pretrained(
        adapter_path,
        torch_dtype="auto",
        device_map=device,
    )

    merged = model.merge_and_unload()
    merged.save_pretrained(output_dir, safe_serialization=True)

    try:
        # Fix for Mistral tokenizer regex warning if applicable
        tokenizer = AutoTokenizer.from_pretrained(adapter_path, fix_mistral_regex=True)
    except TypeError:
        # For older versions of transformers that don't support fix_mistral_regex
        tokenizer = AutoTokenizer.from_pretrained(adapter_path)

    tokenizer.save_pretrained(output_dir)
    print(output_dir)
except Exception as e:
    print(str(e), file=sys.stderr)
    sys.exit(1)
`.trim();

  const child = require('child_process').spawn(CONFIG.pythonBin, ['-u', '-c', py], {
    cwd: CONFIG.workspace,
    detached: true,
    stdio: 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  const building = await upsertLora({
    ...next0,
    mergePid: child.pid,
  });
  emitEvent('lora_updated', building);

  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('exit', async (code) => {
    const current = await getLoraById(loraId);
    const next = await upsertLora({
      ...current,
      mergeStatus: code === 0 ? 'ready' : 'failed',
      mergePid: null,
      mergedPath: code === 0 ? mergedPath : current.mergedPath,
      error: code === 0 ? null : (stderr.trim() || `exit code ${code}`),
    });
    emitEvent('lora_updated', next);
    if (code === 0) {
      logger.info(`LoRA merge completed: ${loraId}`, { mergedPath });
    } else {
      logger.error(`LoRA merge failed: ${loraId}`, { error: next.error });
    }
  });

  return building;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureMergedLora(loraId) {
  let item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  if (item.mergeStatus === 'ready' && item.mergedPath && fs.existsSync(item.mergedPath)) {
    return item;
  }

  if (item.mergeStatus !== 'building' || !item.mergePid || !isPidRunning(item.mergePid)) {
    await buildMergedLora(loraId);
  }

  // Wait for it to complete
  while (true) {
    await sleep(2000);
    item = await getLoraById(loraId);
    if (item.mergeStatus !== 'building') break;
  }

  if (item.mergeStatus === 'ready') return item;
  throw new Error(item.error || 'LoRA merge failed');
}

async function packageMergedLora(loraId) {
  let item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  if (item.mergeStatus !== 'ready') {
    item = await ensureMergedLora(loraId);
  }

  if (item.packageStatus === 'building' && item.packagePid && isPidRunning(item.packagePid)) {
    return item;
  }

  const archivePath = path.join(CONFIG.packagesDir, `${item.id}.tar.gz`);
  fs.mkdirSync(CONFIG.packagesDir, { recursive: true });

  const next0 = await upsertLora({
    ...item,
    packageStatus: 'building',
    packagePath: archivePath,
    packagePid: null,
    error: null,
  });
  emitEvent('lora_updated', next0);

  const child = require('child_process').spawn(
    'tar',
    [
      '-czf',
      archivePath,
      '-C',
      path.dirname(item.mergedPath),
      path.basename(item.mergedPath),
    ],
    {
      cwd: CONFIG.workspace,
      stdio: 'pipe',
    },
  );

  const building = await upsertLora({
    ...next0,
    packagePid: child.pid,
  });
  emitEvent('lora_updated', building);

  let stderr = '';
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });

  child.on('exit', async (code) => {
    const current = await getLoraById(loraId);
    const next = await upsertLora({
      ...current,
      packageStatus: code === 0 ? 'ready' : 'failed',
      packagePid: null,
      packagePath: code === 0 ? archivePath : current.packagePath,
      error: code === 0 ? null : (stderr.trim() || `exit code ${code}`),
    });
    emitEvent('lora_updated', next);
  });

  return building;
}

module.exports = {
  registerLoraFromJob,
  buildMergedLora,
  ensureMergedLora,
  packageMergedLora,
};