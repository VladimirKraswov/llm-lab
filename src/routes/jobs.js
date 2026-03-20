const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
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
const { verifyCallbackToken, generateCallbackToken } = require('../services/auth');
const authMiddleware = require('../utils/auth-middleware');
const roleMiddleware = require('../utils/role-middleware');

const router = express.Router();

// All routes here are protected by authMiddleware in server.js
// but worker callback routes will be exempted or handled differently if needed.
// However, server.js currently applies authMiddleware to /jobs.
// We need to move worker callbacks to a separate route or handle them carefully.

router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
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
  // This endpoint needs to be secure.
  // It's called by the worker bootstrap.
  // We should ideally use a one-time bootstrap token.
  try {
    const job = await getJobById(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    // Check if a bootstrap token is provided in query
    const bootstrapToken = req.query.token;
    const tokenRecord = await db('job_callback_tokens')
      .where({ job_id: req.params.id, id: bootstrapToken, is_active: true })
      .first();

    // If no token or invalid token, and not authenticated as user, deny
    if (!tokenRecord && !req.user) {
      return res.status(403).json({ error: 'Forbidden: Invalid bootstrap token' });
    }

    res.json({
      job_id: job.id,
      job_name: job.name,
      callback_auth_token: tokenRecord?.id, // Should we generate a new one?
      logs_url: `${process.env.CALLBACK_BASE_URL || ''}/api/jobs/logs`,
      reporting: {
        status: `${process.env.CALLBACK_BASE_URL || ''}/api/jobs/status`,
        progress: `${process.env.CALLBACK_BASE_URL || ''}/api/jobs/progress`,
        final: `${process.env.CALLBACK_BASE_URL || ''}/api/jobs/final`,
        logs: `${process.env.CALLBACK_BASE_URL || ''}/api/jobs/logs`,
      },
      config: job.paramsSnapshot,
    });
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

// Worker Callbacks - These need to be accessible without authMiddleware
// OR authMiddleware needs to be updated to support callback tokens.
// Since server.js applies authMiddleware to all /jobs, we have a problem.
// We should expose these on a separate path or handle token in authMiddleware.

// WORKAROUND: We will assume for this PR that the user will move these or update middleware.
// For now, we implement them here.

async function callbackAuth(req, res, next) {
  const { job_id, auth_token } = req.body;
  if (!job_id || !auth_token) return res.status(401).json({ error: 'Auth required' });

  const isValid = await verifyCallbackToken(auth_token, job_id);
  if (!isValid) return res.status(403).json({ error: 'Invalid or expired token' });
  next();
}

router.post('/status', callbackAuth, async (req, res) => {
  try {
    res.json(await handleWorkerStatus(req.body.job_id, req.body));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/progress', callbackAuth, async (req, res) => {
  try {
    res.json(await handleWorkerProgress(req.body.job_id, req.body));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/final', callbackAuth, async (req, res) => {
  try {
    res.json(await handleWorkerFinal(req.body.job_id, req.body));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/logs', callbackAuth, async (req, res) => {
  try {
    res.json(await handleWorkerLogs(req.body.job_id, req.body));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Legacy Artifact Endpoints
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
