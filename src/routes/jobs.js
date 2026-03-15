const express = require('express');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
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

router.get('/:id/artifacts/metrics', async (req, res) => {
  try {
    const { outputDir } = await getJobById(req.params.id);
    const filePath = path.join(outputDir, 'metrics.json');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Metrics not found' });
    }
    res.download(filePath, 'metrics.json');
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

router.get('/:id/artifacts/logs', async (req, res) => {
  try {
    const { logFile } = await getJobById(req.params.id);
    if (!fs.existsSync(logFile)) {
      return res.status(404).json({ error: 'Logs not found' });
    }
    res.download(logFile, `${req.params.id}.log`);
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

router.get('/:id/artifacts/wandb', async (req, res) => {
  try {
    const { outputDir } = await getJobById(req.params.id);
    const wandbDir = path.join(outputDir, 'wandb');
    if (!fs.existsSync(wandbDir)) {
      return res.status(404).json({ error: 'W&B data not found' });
    }

    res.attachment(`wandb-${req.params.id}.tar.gz`);
    const archive = archiver('tar', { gzip: true });
    archive.pipe(res);
    archive.directory(wandbDir, 'wandb');
    archive.finalize();
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;
