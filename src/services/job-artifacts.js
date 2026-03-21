const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const { CONFIG } = require('../config');
const { db } = require('../db');
const logger = require('../utils/logger');

const ARTIFACT_TYPE_ALIASES = {
  logs: 'logs',
  log: 'logs',

  config: 'effective_config',
  effective_config: 'effective_config',
  'effective-config': 'effective_config',

  summary: 'summary',
  job_summary: 'summary',
  'job-summary': 'summary',

  train_metrics: 'train_metrics',
  'train-metrics': 'train_metrics',
  trainmetrics: 'train_metrics',

  train_history: 'train_history',
  'train-history': 'train_history',
  trainhistory: 'train_history',

  evaluation_summary: 'eval_summary',
  eval_summary: 'eval_summary',
  'eval-summary': 'eval_summary',

  evaluation_details: 'eval_details',
  eval_details: 'eval_details',
  'eval-details': 'eval_details',

  lora: 'lora_archive',
  lora_archive: 'lora_archive',
  'lora-archive': 'lora_archive',

  merged: 'merged_archive',
  merged_archive: 'merged_archive',
  'merged-archive': 'merged_archive',

  full_archive: 'full_archive',
  'full-archive': 'full_archive',

  hf_lora: 'hf_lora',
  'hf-lora': 'hf_lora',
  hf_merged: 'hf_merged',
  'hf-merged': 'hf_merged',
  hf_metadata: 'hf_metadata',
  'hf-metadata': 'hf_metadata',
};

const CANONICAL_TO_ROUTE = {
  logs: 'logs',
  effective_config: 'config',
  summary: 'summary',
  train_metrics: 'train-metrics',
  train_history: 'train-history',
  eval_summary: 'eval-summary',
  eval_details: 'eval-details',
  lora_archive: 'lora',
  merged_archive: 'merged',
  full_archive: 'full-archive',
  hf_lora: 'hf-lora',
  hf_merged: 'hf-merged',
  hf_metadata: 'hf-metadata',
};

function safeName(value, fallback = 'artifact.bin') {
  const normalized = String(value || '').trim();
  const basename = path.basename(normalized || fallback);
  const cleaned = basename.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || fallback;
}

function normalizeArtifactType(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  if (ARTIFACT_TYPE_ALIASES[lower]) {
    return ARTIFACT_TYPE_ALIASES[lower];
  }

  return lower.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function artifactTypeToRouteSlug(value) {
  const normalized = normalizeArtifactType(value);
  if (!normalized) return null;
  return CANONICAL_TO_ROUTE[normalized] || normalized.replace(/_/g, '-');
}

function buildArtifactDownloadUrl(publicBaseUrl, jobId, artifactType) {
  const base = String(publicBaseUrl || CONFIG.callbackBaseUrl || '').replace(/\/+$/, '');
  const routeSlug = artifactTypeToRouteSlug(artifactType);
  if (!base || !routeSlug) return null;

  return `${base}/api/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(routeSlug)}/download`;
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function moveFileSafe(src, dst) {
  try {
    await fsp.rename(src, dst);
  } catch (err) {
    if (err && err.code === 'EXDEV') {
      await fsp.copyFile(src, dst);
      await fsp.unlink(src).catch(() => {});
      return;
    }
    throw err;
  }
}

async function storeUploadedArtifact({ jobId, artifactType, file }) {
  const normalizedType = normalizeArtifactType(artifactType);
  if (!normalizedType) {
    throw new Error('artifactType is required');
  }

  if (!file?.path) {
    throw new Error('uploaded file is missing');
  }

  const fileName = safeName(file.originalname, `${artifactTypeToRouteSlug(normalizedType) || normalizedType}.bin`);
  const artifactDir = path.join(CONFIG.jobArtifactsDir, jobId, normalizedType);

  await fsp.rm(artifactDir, { recursive: true, force: true }).catch(() => {});
  await ensureDir(artifactDir);

  const finalPath = path.join(artifactDir, fileName);
  await moveFileSafe(file.path, finalPath);

  return {
    artifactType: normalizedType,
    filename: fileName,
    storagePath: finalPath,
    sizeBytes: Number(file.size || 0),
    contentType: file.mimetype || 'application/octet-stream',
  };
}

async function getJobArtifact(jobId, artifactType) {
  const normalizedType = normalizeArtifactType(artifactType);
  if (!normalizedType) return null;

  return db('job_artifacts')
    .where({ job_id: jobId, type: normalizedType })
    .first();
}

async function upsertArtifactRecord({
  jobId,
  artifactType,
  filename,
  storagePath = null,
  downloadUrl = null,
  sizeBytes = null,
}) {
  const normalizedType = normalizeArtifactType(artifactType);
  if (!normalizedType) {
    throw new Error('artifactType is required');
  }

  await db('job_artifacts')
    .where({ job_id: jobId, type: normalizedType })
    .del();

  await db('job_artifacts').insert({
    job_id: jobId,
    name: filename || normalizedType,
    type: normalizedType,
    path: storagePath,
    url: downloadUrl,
    size: sizeBytes,
  });

  return getJobArtifact(jobId, normalizedType);
}

async function registerUploadedArtifact({
  jobId,
  artifactType,
  file,
  publicBaseUrl,
}) {
  const stored = await storeUploadedArtifact({
    jobId,
    artifactType,
    file,
  });

  const downloadUrl = buildArtifactDownloadUrl(publicBaseUrl, jobId, stored.artifactType);

  const record = await upsertArtifactRecord({
    jobId,
    artifactType: stored.artifactType,
    filename: stored.filename,
    storagePath: stored.storagePath,
    downloadUrl,
    sizeBytes: stored.sizeBytes,
  });

  return {
    record,
    stored,
    downloadUrl,
    artifactType: stored.artifactType,
  };
}

async function syncFinalArtifactsToJob({
  jobId,
  uploads,
  publicBaseUrl,
}) {
  const result = [];

  for (const [rawType, payload] of Object.entries(uploads || {})) {
    const artifactType = normalizeArtifactType(rawType);
    if (!artifactType) continue;

    const existing = await getJobArtifact(jobId, artifactType);
    if (existing && (existing.path || existing.url)) {
      result.push(existing);
      continue;
    }

    const fileName = safeName(
      path.basename(
        payload?.path ||
        payload?.archive_path ||
        payload?.repo_id ||
        payload?.url ||
        artifactTypeToRouteSlug(artifactType) ||
        artifactType
      ),
      `${artifactTypeToRouteSlug(artifactType) || artifactType}.bin`,
    );

    let externalUrl =
      payload?.download_url ||
      null;

    if (!externalUrl && payload?.repo_id) {
      externalUrl = `https://huggingface.co/${payload.repo_id}`;
    }

    if (!externalUrl && payload?.url && !String(payload.url).includes('/upload/')) {
      externalUrl = payload.url;
    }

    const downloadUrl =
      existing?.url ||
      externalUrl ||
      buildArtifactDownloadUrl(publicBaseUrl, jobId, artifactType);

    const record = await upsertArtifactRecord({
      jobId,
      artifactType,
      filename: existing?.name || fileName,
      storagePath: existing?.path || null,
      downloadUrl,
      sizeBytes: existing?.size || payload?.size || null,
    });

    result.push(record);
  }

  return result;
}

module.exports = {
  normalizeArtifactType,
  artifactTypeToRouteSlug,
  buildArtifactDownloadUrl,
  getJobArtifact,
  upsertArtifactRecord,
  registerUploadedArtifact,
  syncFinalArtifactsToJob,
};
