const express = require('express');
const { getSettings, getRuntime, getJobs, getDatasets } = require('../services/state');
const { CONFIG } = require('../config');
const { exists } = require('../utils/fs');

const router = express.Router();

router.get('/summary', async (_req, res) => {
  const [settings, runtime, jobs, datasets] = await Promise.all([
    getSettings(),
    getRuntime(),
    getJobs(),
    getDatasets(),
  ]);

  const recentJobs = [...jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 5);

  res.json({
    health: {
      ok: true,
      python: exists(CONFIG.pythonBin),
      transformersPython: exists(CONFIG.transformersPythonBin),
      vllmBin: exists(CONFIG.vllmBin),
      time: new Date().toISOString(),
    },
    settings: {
      baseModel: settings.baseModel,
      inferenceModel: settings.inference.model,
      inferencePort: settings.inference.port,
    },
    runtime,
    counts: {
      datasets: datasets.length,
      jobs: jobs.length,
      runningJobs: jobs.filter((x) => x.status === 'running').length,
      completedJobs: jobs.filter((x) => x.status === 'completed').length,
      failedJobs: jobs.filter((x) => x.status === 'failed').length,
    },
    recentJobs,
  });
});

module.exports = router;