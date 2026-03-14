const express = require('express');
const { getJobs } = require('../services/state');
const { startFineTuneJob, stopJob, getJobById, getJobLogs } = require('../services/jobs');

const router = express.Router();

router.get('/', async (_req, res) => {
  res.json(await getJobs());
});

router.get('/:id', async (req, res) => {
  try {
    res.json(await getJobById(req.params.id));
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
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

router.post('/fine-tune', async (req, res) => {
  try {
    res.json(await startFineTuneJob(req.body || {}));
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

module.exports = router;
