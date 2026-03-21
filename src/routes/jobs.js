const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../db');
const archiver = require('archiver');
const {
  createRemoteJob,
  cloneJob,
  retryJob,
  cancelJob,
  normalizeJobStatus,
  handleWorkerStatus,
  handleWorkerProgress,
  handleWorkerFinal,
  handleWorkerLogs,
  startSyntheticGenJob,
  updateJobMetadata,
  stopJob,
  getJobById,
  getJobEvents,
  getJobLogs,
  getJobLaunchCommand,
  getAllJobs,
} = require('../services/jobs');
const { syncJobFromHF } = require('../services/hf-sync');
const {
  verifyCallbackToken,
  generateCallbackToken,
} = require('../services/auth');
const roleMiddleware = require('../utils/role-middleware');
const { getDatasets } = require('../services/state');
const { buildRemoteTrainerConfig } = require('../services/remote-job-config');
const { CONFIG } = require('../config');
const { buildPublicBaseUrl } = require('../utils/public-base-url');
const { getRuntimePresets, getRuntimePresetById } = require('../services/runtime-presets');
const { generateDockerCompose, generateEnvFile, generateReadme } = require('../services/launch-bundle');
const {
  normalizeArtifactType,
  registerUploadedArtifact,
  syncFinalArtifactsToJob,
  getJobArtifact,
} = require('../services/job-artifacts');

const router = express.Router();

const uploadTempDir = path.join(CONFIG.jobArtifactsDir, '_incoming');
fs.mkdirSync(uploadTempDir, { recursive: true });

const upload = multer({
  dest: uploadTempDir,
});


async function callbackAuth(req, res, next) {
  try {
    if (req.user) return next();

    const authHeader = req.headers.authorization || '';
    let token = null;

    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.slice('Bearer '.length).trim();
    }

    if (!token) {
      token =
        req.body?.auth_token ||
        req.body?.callback_auth_token ||
        req.query?.token ||
        null;
    }

    const jobId = req.body?.job_id || req.params?.id;

    if (!jobId || !token) {
      return res.status(401).json({ error: 'Auth required' });
    }

    const isValid = await verifyCallbackToken(token, jobId);
    if (!isValid) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    req.callbackToken = token;
    next();
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}

async function getOrCreateJobCallbackToken(jobId) {
  let tokenRecord = await db('job_callback_tokens')
    .where({ job_id: jobId, is_active: true })
    .orderBy('created_at', 'desc')
    .first();

  if (!tokenRecord) {
    const token = await generateCallbackToken(jobId);
    tokenRecord = { id: token };
  }

  return tokenRecord.id;
}

async function buildLaunchInfo(job, req) {
  if (!job || job.mode !== 'remote') {
    return null;
  }

  const callbackToken = await getOrCreateJobCallbackToken(job.id);

  const baseJobConfigUrl =
    String(job.jobConfigUrl || '').trim() ||
    `${buildPublicBaseUrl(req, CONFIG.callbackBaseUrl)}/api/jobs/${job.id}/config`;

  const launchJobConfigUrl =
    baseJobConfigUrl.includes('?token=')
      ? baseJobConfigUrl
      : `${baseJobConfigUrl}?token=${encodeURIComponent(callbackToken)}`;

  const image = job.containerImage || 'itk-ai-trainer-service:qwen-7b';

  return {
    jobConfigUrl: launchJobConfigUrl,
    env: {
      JOB_CONFIG_URL: launchJobConfigUrl,
    },
    exampleDockerRun: [
      'docker run --rm --gpus all \\',
      '  --shm-size 16g \\',
      `  -e JOB_CONFIG_URL="${launchJobConfigUrl}" \\`,
      '  -e HF_TOKEN="$HF_TOKEN" \\',
      `  ${image}`,
    ].join('\n'),
  };
}

router.get('/runtime-presets', async (req, res) => {
  try {
    res.json(await getRuntimePresets());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    res.json(await getAllJobs(limit, offset));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/artifacts/:artifactType/download', async (req, res) => {
  try {
    const record = await getJobArtifact(req.params.id, req.params.artifactType);
    if (!record) {
      return res.status(404).json({ error: 'artifact not found' });
    }

    if (record.path && fs.existsSync(record.path)) {
      return res.download(record.path, path.basename(record.path));
    }

    if (record.url) {
      return res.redirect(record.url);
    }

    return res.status(404).json({ error: 'artifact is not downloadable' });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const artifacts = await db('job_artifacts').where({ job_id: req.params.id });
    const launch = await buildLaunchInfo(job, req);

    res.json({ ...job, artifacts, launch });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/events', async (req, res) => {
  try {
    res.json(await getJobEvents(req.params.id));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/launch-command', async (req, res) => {
  try {
    res.json({ command: await getJobLaunchCommand(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/remote-train', roleMiddleware(['admin', 'member']), async (req, res) => {
  try {
    const { datasetId } = req.body;
    if (!datasetId) {
      return res.status(400).json({ error: 'datasetId is required' });
    }

    const publicBaseUrl = buildPublicBaseUrl(req, CONFIG.callbackBaseUrl);
    res.json(await createRemoteJob(req.body || {}, { publicBaseUrl }));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/retry', roleMiddleware(['admin', 'member']), async (req, res) => {
  try {
    res.json(await retryJob(req.params.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/clone', async (req, res) => {
  try {
    res.json(await cloneJob(req.params.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/cancel', async (req, res) => {
  try {
    res.json(await cancelJob(req.params.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.get('/:id/config', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const bootstrapToken = req.query.token || null;

    let tokenRecord = null;
    if (bootstrapToken) {
      tokenRecord = await db('job_callback_tokens')
        .where({ job_id: req.params.id, id: bootstrapToken, is_active: true })
        .first();
    }

    if (!tokenRecord && !req.user) {
      return res.status(403).json({ error: 'Forbidden: Invalid bootstrap token' });
    }

    if (!tokenRecord) {
      tokenRecord = await db('job_callback_tokens')
        .where({ job_id: req.params.id, is_active: true })
        .first();
    }

    if (!tokenRecord) {
      return res.status(500).json({ error: 'No active callback token found for job' });
    }

    const datasets = await getDatasets();
    const dataset = datasets.find((x) => x.id === job.datasetId);
    if (!dataset) {
      return res.status(404).json({ error: 'Dataset not found for job' });
    }

    const publicBaseUrl = buildPublicBaseUrl(req, CONFIG.callbackBaseUrl);

    const trainerConfig = buildRemoteTrainerConfig({
      job,
      dataset,
      callbackAuthToken: tokenRecord.id,
      publicBaseUrl,
    });

    const reporting = trainerConfig.reporting || {};

    res.json({
      job_id: job.id,
      job_name: job.name,
      callback_auth_token: tokenRecord.id,
      logs_url: reporting.logs?.url || null,
      reporting,
      config: trainerConfig,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/dataset/train', callbackAuth, async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const datasets = await getDatasets();
    const dataset = datasets.find((x) => x.id === job.datasetId);
    if (!dataset?.processedPath) {
      return res.status(404).json({ error: 'Processed dataset not found' });
    }

    const resolved = path.resolve(dataset.processedPath);
    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'Dataset file is missing on disk' });
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    return res.sendFile(resolved);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/logs', async (req, res) => {
  try {
    const tail = Math.max(20, Math.min(2000, Number(req.query.tail || 200)));
    res.json(await getJobLogs(req.params.id, tail));
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

router.post('/upload/:artifactType', upload.single('file'), callbackAuth, async (req, res) => {
  try {
    const jobId = String(req.body?.job_id || '').trim();
    if (!jobId) {
      return res.status(400).json({ error: 'job_id is required' });
    }

    const job = await getJobById(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'file is required' });
    }

    const publicBaseUrl = buildPublicBaseUrl(req, CONFIG.callbackBaseUrl);
    const artifactType = normalizeArtifactType(req.params.artifactType || req.body?.artifact_type);

    const { record, downloadUrl } = await registerUploadedArtifact({
      jobId,
      artifactType,
      file: req.file,
      publicBaseUrl,
    });

    await db('job_events').insert({
      job_id: jobId,
      type: 'artifact_upload',
      payload: JSON.stringify({
        artifactType,
        filename: record?.name || req.file.originalname,
        downloadUrl,
      }),
    });

    return res.status(201).json({
      ok: true,
      artifact_id: `${jobId}:${artifactType}`,
      job_id: jobId,
      artifact_type: artifactType,
      storage_key: record?.path || null,
      download_url: downloadUrl || record?.url || null,
    });
  } catch (err) {
    if (req.file?.path) {
      fs.rm(req.file.path, { force: true }, () => {});
    }
    return res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/fine-tune', roleMiddleware(['admin', 'member']), async (req, res) => {
  try {
    res.json(await createRemoteJob({
      ...(req.body || {}),
      type: 'fine-tune',
    }));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/synthetic-gen', roleMiddleware(['admin', 'member']), async (req, res) => {
  try {
    res.json(await startSyntheticGenJob(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.patch('/:id/metadata', async (req, res) => {
  try {
    res.json(await updateJobMetadata(req.params.id, req.body || {}));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/stop', async (req, res) => {
  try {
    res.json(await stopJob(req.params.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/hf-sync', roleMiddleware(['admin', 'member']), async (req, res) => {
  try {
    const result = await syncJobFromHF(req.params.id);
    if (!result.ok) {
      return res.status(404).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/status', callbackAuth, async (req, res) => {
  try {
    const normalized = {
      ...req.body,
      status: normalizeJobStatus(req.body.status),
    };
    res.json(await handleWorkerStatus(normalized.job_id, normalized));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/progress', callbackAuth, async (req, res) => {
  try {
    const normalized = {
      ...req.body,
      status: normalizeJobStatus(req.body.status || 'running'),
    };
    res.json(await handleWorkerProgress(normalized.job_id, normalized));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/final', callbackAuth, async (req, res) => {
  try {
    const result = req.body?.result || {};
    const normalized = {
      ...req.body,
      status: normalizeJobStatus(req.body.status || result.status || 'finished'),
      metrics: {
        training: result?.training?.summary || null,
        evaluation: result?.evaluation?.summary || null,
      },
      artifacts: result?.uploads || {},
    };

    const response = await handleWorkerFinal(normalized.job_id, normalized);

    await syncFinalArtifactsToJob({
      jobId: normalized.job_id,
      uploads: result?.uploads || {},
      publicBaseUrl: buildPublicBaseUrl(req, CONFIG.callbackBaseUrl),
    });

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/logs', callbackAuth, async (req, res) => {
  try {
    const normalized = {
      ...req.body,
      logs:
        req.body.logs ||
        req.body.chunk ||
        req.body.content ||
        '',
    };

    res.json(await handleWorkerLogs(normalized.job_id, normalized));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/launch/compose', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const preset = job.runtimePresetId ? await getRuntimePresetById(job.runtimePresetId) : null;
    res.setHeader('Content-Type', 'text/yaml');
    res.send(generateDockerCompose(job, preset));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/launch/env', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const launch = await buildLaunchInfo(job, req);
    res.setHeader('Content-Type', 'text/plain');
    res.send(generateEnvFile(job, launch.jobConfigUrl));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/launch/bundle', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const token = req.query.token;
    if (token) {
      const { verifyToken } = require('../services/auth');
      const user = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Invalid download token' });
    } else if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const launch = await buildLaunchInfo(job, req);
    const preset = job.runtimePresetId ? await getRuntimePresetById(job.runtimePresetId) : null;

    const archive = archiver('tar', { gzip: true });
    res.attachment(`job_bundle_${job.id}.tar.gz`);
    archive.pipe(res);

    archive.append(generateDockerCompose(job, preset), { name: 'compose.yaml' });
    archive.append(generateEnvFile(job, launch.jobConfigUrl), { name: '.env.example' });
    archive.append(generateReadme(job), { name: 'README.txt' });

    archive.finalize();
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/artifacts/metrics', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (job.mode === 'local') {
      const filePath = path.join(job.outputDir, 'metrics.json');
      if (fs.existsSync(filePath)) return res.download(filePath, 'metrics.json');
    }
    res.status(404).json({ error: 'Metrics not found' });
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

module.exports = router;
