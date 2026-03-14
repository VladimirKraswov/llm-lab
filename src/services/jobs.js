const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { CONFIG } = require('../config');
const { nowIso, uid } = require('../utils/ids');
const { isPidRunning, killProcessGroup } = require('../utils/proc');
const { getSettings, getDatasets, getJobs, upsertJob, getModelById } = require('./state');
const { emitEvent } = require('./events');
const { readText } = require('../utils/fs');
const { registerLoraFromJob } = require('./loras');

function buildTrainPython(job, settings) {
  const cfg = {
    baseModel: job.baseModel,
    datasetPath: job.datasetPath,
    outputDir: job.outputDir,
    qlora: { ...settings.qlora, ...(job.qlora || {}) },
  };

  return `
import json
import os
import unsloth
import torch

from datasets import load_dataset
from unsloth import FastLanguageModel
from transformers import TrainingArguments
from trl import SFTTrainer

cfg = json.loads(${JSON.stringify(JSON.stringify(cfg))})

os.makedirs(cfg["outputDir"], exist_ok=True)

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=cfg["baseModel"],
    max_seq_length=cfg["qlora"]["maxSeqLength"],
    load_in_4bit=cfg["qlora"]["loadIn4bit"],
    trust_remote_code=True,
)

if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

model = FastLanguageModel.get_peft_model(
    model,
    r=cfg["qlora"]["loraR"],
    target_modules=cfg["qlora"]["targetModules"],
    lora_alpha=cfg["qlora"]["loraAlpha"],
    lora_dropout=cfg["qlora"]["loraDropout"],
    bias="none",
    use_gradient_checkpointing="unsloth",
)

if torch.cuda.is_available():
    model = model.to("cuda")

dataset = load_dataset("json", data_files=cfg["datasetPath"], split="train")

def format_row(row):
    messages = row.get("messages", [])
    if not isinstance(messages, list) or len(messages) < 2:
        return {"text": ""}

    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=False,
    )
    return {"text": text}

dataset = dataset.map(format_row)
dataset = dataset.filter(lambda x: bool(x["text"] and x["text"].strip()))

if len(dataset) == 0:
    raise ValueError("Dataset is empty after formatting/filtering")

use_bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()

args = TrainingArguments(
    output_dir=cfg["outputDir"],
    per_device_train_batch_size=cfg["qlora"]["perDeviceTrainBatchSize"],
    gradient_accumulation_steps=cfg["qlora"]["gradientAccumulationSteps"],
    learning_rate=cfg["qlora"]["learningRate"],
    num_train_epochs=cfg["qlora"]["numTrainEpochs"],
    warmup_ratio=cfg["qlora"]["warmupRatio"],
    logging_steps=1,
    save_strategy="epoch",
    save_safetensors=True,
    bf16=use_bf16,
    fp16=not use_bf16,
    report_to=[],
    remove_unused_columns=False,
    group_by_length=False,
    optim="adamw_8bit",
)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=args,
    dataset_text_field="text",
    packing=False,
    dataset_num_proc=1,
)

trainer.train()
trainer.save_model(cfg["outputDir"])
tokenizer.save_pretrained(cfg["outputDir"])

print(json.dumps({
    "ok": True,
    "outputDir": cfg["outputDir"],
    "rows": len(dataset),
    "bf16": use_bf16,
}))
`.trim();
}

async function startFineTuneJob({ datasetId, name, modelId, baseModel, qlora }) {
  const settings = await getSettings();
  const datasets = await getDatasets();
  const ds = datasets.find((x) => x.id === datasetId);
  if (!ds) throw new Error('dataset not found');

  let selectedBaseModel = baseModel || settings.baseModel;
  let selectedModelId = modelId || null;

  if (modelId) {
    const model = await getModelById(modelId);
    if (!model) throw new Error('model not found');
    if (model.status !== 'ready') throw new Error('model is not ready');
    selectedBaseModel = model.path;
  }

  const jobId = uid('job');
  const outputDir = path.join(CONFIG.trainingOutputsDir, jobId);
  const logFile = path.join(CONFIG.logsDir, `${jobId}.log`);

  const job = {
    id: jobId,
    type: 'fine-tune',
    name: name || jobId,
    status: 'queued',
    createdAt: nowIso(),
    startedAt: null,
    finishedAt: null,
    datasetId,
    datasetPath: ds.processedPath,
    modelId: selectedModelId,
    baseModel: selectedBaseModel,
    qlora: qlora || {},
    outputDir,
    logFile,
    pid: null,
    error: null,
  };

  await upsertJob(job);
  emitEvent('job_updated', job);

  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(CONFIG.logsDir, { recursive: true });

  const script = buildTrainPython(job, settings);
  const outFd = fs.openSync(logFile, 'a');

  const child = spawn(CONFIG.pythonBin, ['-u', '-c', script], {
    cwd: CONFIG.workspace,
    detached: true,
    stdio: ['ignore', outFd, outFd],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  child.unref();

  const runningJob = await upsertJob({
    ...job,
    status: 'running',
    startedAt: nowIso(),
    pid: child.pid,
  });
  emitEvent('job_updated', runningJob);

  child.on('exit', async (code) => {
    const jobs = await getJobs();
    const current = jobs.find((j) => j.id === jobId);
    if (!current) return;

    const next = await upsertJob({
      ...current,
      status: code === 0 ? 'completed' : 'failed',
      finishedAt: nowIso(),
      error: code === 0 ? null : `trainer exited with code ${code}`,
    });

    emitEvent('job_updated', next);

    if (code === 0) {
      try {
        await registerLoraFromJob(jobId);
      } catch (err) {
        emitEvent('lora_register_failed', {
          jobId,
          error: String(err.message || err),
        });
      }
    }
  });

  child.on('error', async (err) => {
    const jobs = await getJobs();
    const current = jobs.find((j) => j.id === jobId);
    if (!current) return;

    const next = await upsertJob({
      ...current,
      status: 'failed',
      finishedAt: nowIso(),
      error: String(err.message || err),
    });

    emitEvent('job_updated', next);
  });

  return { ok: true, jobId, logFile, outputDir };
}

async function stopJob(jobId) {
  const jobs = await getJobs();
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('job not found');
  if (!job.pid || !isPidRunning(job.pid)) throw new Error('job is not running');

  killProcessGroup(job.pid);

  const next = await upsertJob({
    ...job,
    status: 'stopped',
    finishedAt: nowIso(),
  });

  emitEvent('job_updated', next);
  return { ok: true };
}

async function getJobById(id) {
  const jobs = await getJobs();
  const job = jobs.find((x) => x.id === id);
  if (!job) throw new Error('job not found');
  return job;
}

async function getJobLogs(id, tail = 200) {
  const job = await getJobById(id);
  const text = await readText(job.logFile, '');
  const lines = text.split('\n');

  return {
    id: job.id,
    logFile: job.logFile,
    content: lines.slice(-tail).join('\n'),
  };
}

module.exports = {
  startFineTuneJob,
  stopJob,
  getJobById,
  getJobLogs,
};