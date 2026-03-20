const express = require('express');
const fs = require('fs');
const path = require('path');
const { db } = require('../db');
const {
  startFineTuneJob,
  createRemoteJob,
  cloneJob,
  retryJob,
  cancelJob,
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
const { verifyCallbackToken } = require('../services/auth');
const roleMiddleware = require('../utils/role-middleware');
const { getDatasets } = require('../services/state');
const { buildRemoteTrainerConfig } = require('../services/remote-job-config');

const router = express.Router();

function mapIncomingStatus(status) {
  const value = String(status || '').trim().toLowerCase();

  if (!value) return 'running';
  if (value === 'started') return 'running';
  if (value === 'finished') return 'completed';
  if (value === 'success') return 'completed';
  if (value === 'error') return 'failed';

  return value;
}

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

router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const offset = parseInt(req.query.offset, 10) || 0;
    res.json(await getAllJobs(limit, offset));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const artifacts = await db('job_artifacts').where({ job_id: req.params.id });
    res.json({ ...job, artifacts });
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
    res.json(await createRemoteJob(req.body || {}));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/retry', async (req, res) => {
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

    const trainerConfig = buildRemoteTrainerConfig({
      job,
      dataset,
      callbackAuthToken: tokenRecord.id,
    });

    res.json({
      job_id: job.id,
      job_name: job.name,
      callback_auth_token: tokenRecord.id,
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

router.post('/fine-tune', roleMiddleware(['admin', 'member']), async (req, res) => {
  try {
    res.json(await startFineTuneJob(req.body || {}));
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

router.post('/status', callbackAuth, async (req, res) => {
  try {
    const normalized = {
      ...req.body,
      status: mapIncomingStatus(req.body.status),
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
      status: mapIncomingStatus(req.body.status || 'running'),
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
      status: mapIncomingStatus(req.body.status || result.status),
      metrics: {
        training: result?.training?.summary || null,
        evaluation: result?.evaluation?.summary || null,
      },
      artifacts: result?.uploads || {},
    };

    res.json(await handleWorkerFinal(normalized.job_id, normalized));
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