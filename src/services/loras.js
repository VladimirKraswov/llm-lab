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
const { emitEvent } = require('./events');

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
  return item;
}

function runPy(script) {
  const r = spawnSync(CONFIG.pythonBin, ['-u', '-c', script], {
    cwd: CONFIG.workspace,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || 'python failed').trim());
  }

  return (r.stdout || '').trim();
}

async function buildMergedLora(loraId) {
  const item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  const mergedPath = path.join(CONFIG.mergedModelsDir, `${item.id}-merged`);
  fs.mkdirSync(CONFIG.mergedModelsDir, { recursive: true });

  const next0 = await upsertLora({
    ...item,
    mergeStatus: 'building',
    mergedPath,
    error: null,
  });
  emitEvent('lora_updated', next0);

  const py = `
import os
from peft import AutoPeftModelForCausalLM
from transformers import AutoTokenizer

adapter_path = ${JSON.stringify(item.adapterPath)}
output_dir = ${JSON.stringify(mergedPath)}

os.makedirs(output_dir, exist_ok=True)

model = AutoPeftModelForCausalLM.from_pretrained(
    adapter_path,
    torch_dtype="auto",
    device_map="cpu",
)

merged = model.merge_and_unload()
merged.save_pretrained(output_dir, safe_serialization=True)

tokenizer = AutoTokenizer.from_pretrained(adapter_path)
tokenizer.save_pretrained(output_dir)

print(output_dir)
`.trim();

  try {
    runPy(py);

    const next = await upsertLora({
      ...next0,
      mergeStatus: 'ready',
      mergedPath,
      error: null,
    });
    emitEvent('lora_updated', next);
    return next;
  } catch (err) {
    const failed = await upsertLora({
      ...next0,
      mergeStatus: 'failed',
      error: String(err.message || err),
    });
    emitEvent('lora_updated', failed);
    throw err;
  }
}

async function ensureMergedLora(loraId) {
  const item = await getLoraById(loraId);
  if (!item) throw new Error('lora not found');

  if (item.mergeStatus === 'ready' && item.mergedPath && fs.existsSync(item.mergedPath)) {
    return item;
  }

  return buildMergedLora(loraId);
}

async function packageMergedLora(loraId) {
  const built = await ensureMergedLora(loraId);

  const archivePath = path.join(CONFIG.packagesDir, `${built.id}.tar.gz`);
  fs.mkdirSync(CONFIG.packagesDir, { recursive: true });

  const next0 = await upsertLora({
    ...built,
    packageStatus: 'building',
    packagePath: archivePath,
    error: null,
  });
  emitEvent('lora_updated', next0);

  const r = spawnSync(
    'bash',
    [
      '-lc',
      `tar -czf ${JSON.stringify(archivePath)} -C ${JSON.stringify(path.dirname(built.mergedPath))} ${JSON.stringify(path.basename(built.mergedPath))}`,
    ],
    {
      cwd: CONFIG.workspace,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  if (r.status !== 0) {
    const failed = await upsertLora({
      ...next0,
      packageStatus: 'failed',
      error: (r.stderr || r.stdout || 'packaging failed').trim(),
    });
    emitEvent('lora_updated', failed);
    throw new Error((r.stderr || r.stdout || 'packaging failed').trim());
  }

  const next = await upsertLora({
    ...next0,
    packageStatus: 'ready',
    packagePath: archivePath,
    error: null,
  });
  emitEvent('lora_updated', next);
  return next;
}

module.exports = {
  registerLoraFromJob,
  buildMergedLora,
  ensureMergedLora,
  packageMergedLora,
};