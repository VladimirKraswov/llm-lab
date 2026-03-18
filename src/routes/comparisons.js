const express = require('express');
const fs = require('fs');
const path = require('path');

const { startComparisonJob } = require('../services/comparisons');
const { getJobById } = require('../services/jobs');

const router = express.Router();

router.post('/run', async (req, res) => {
  try {
    const { name, targets, prompts, inference } = req.body || {};
    const result = await startComparisonJob({
      name,
      targets,
      prompts,
      inference,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.get('/:jobId', async (req, res) => {
  try {
    const job = await getJobById(req.params.jobId);
    if (job.type !== 'model-comparison') {
      return res.status(404).json({ error: 'comparison job not found' });
    }
    res.json(job);
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

router.get('/:jobId/result', async (req, res) => {
  try {
    const job = await getJobById(req.params.jobId);
    if (job.type !== 'model-comparison') {
      return res.status(404).json({ error: 'comparison job not found' });
    }

    const filePath = path.join(job.outputDir, 'comparison-result.json');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'comparison-result.json not found' });
    }

    res.sendFile(filePath);
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

router.get('/:jobId/summary', async (req, res) => {
  try {
    const job = await getJobById(req.params.jobId);
    if (job.type !== 'model-comparison') {
      return res.status(404).json({ error: 'comparison job not found' });
    }

    const filePath = path.join(job.outputDir, 'summary.json');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'summary.json not found' });
    }

    res.sendFile(filePath);
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

module.exports = router;