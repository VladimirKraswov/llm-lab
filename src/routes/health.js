const express = require('express');
const { CONFIG } = require('../config');
const { exists } = require('../utils/fs');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    service: 'llm-lab-service',
    time: new Date().toISOString(),
    python: exists(CONFIG.pythonBin),
    transformersPython: exists(CONFIG.transformersPythonBin),
    vllmBin: exists(CONFIG.vllmBin),
    openWebUiPort: CONFIG.openWebUiPort,
    vllmPort: CONFIG.vllmPort,
  });
});

module.exports = router;