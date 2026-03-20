const express = require('express');
const { registerWorker, heartbeat, getJobForWorker } = require('../services/workers');
const { db } = require('../db');

const router = express.Router();
const { getAvailableWorkers } = require('../services/workers');

const authMiddleware = require('../utils/auth-middleware');

router.get('/', authMiddleware, async (req, res) => {
  try {
    res.json(await getAvailableWorkers());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

async function workerAuth(req, res, next) {
  const workerId = req.headers['x-worker-id'];
  const token = req.headers['x-worker-token'];

  if (!workerId || !token) return res.status(401).json({ error: 'Worker auth required' });

  const worker = await db('workers').where({ id: workerId, token }).first();
  if (!worker) return res.status(403).json({ error: 'Invalid worker token' });

  req.worker = worker;
  next();
}

router.post('/register', async (req, res) => {
  try {
    const { name, resources, labels } = req.body;
    res.json(await registerWorker(name, resources, labels));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/heartbeat', workerAuth, async (req, res) => {
  try {
    const { status, resources } = req.body;
    res.json(await heartbeat(req.worker.id, status, resources));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/request-job', workerAuth, async (req, res) => {
  try {
    const job = await getJobForWorker(req.worker.id);
    if (!job) return res.status(204).end();

    // Config as part of request-job is useful for worker bootstrap
    const tokenRecord = await db('job_callback_tokens')
      .where({ job_id: job.id, is_active: true })
      .first();

    res.json({
      job,
      config: {
        job_id: job.id,
        callback_auth_token: tokenRecord?.id,
        reporting: {
          status: `${process.env.CALLBACK_BASE_URL}/api/jobs/status`,
          progress: `${process.env.CALLBACK_BASE_URL}/api/jobs/progress`,
          final: `${process.env.CALLBACK_BASE_URL}/api/jobs/final`,
          logs: `${process.env.CALLBACK_BASE_URL}/api/jobs/logs`,
        },
        params: job.paramsSnapshot,
      }
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;
