const express = require('express');
const { CONFIG } = require('../config');
const { exists } = require('../utils/fs');
const { runText } = require('../utils/proc');

const router = express.Router();

router.get('/', (_req, res) => {
  let quantizeEnvOk = false;

  if (exists(CONFIG.quantizePythonBin)) {
    const probe = runText(CONFIG.quantizePythonBin, ['-c', 'import sys; print(sys.executable)']);
    quantizeEnvOk = probe.ok;
  }

  res.json({
    ok: true,
    service: 'llm-lab-service',
    time: new Date().toISOString(),
    python: exists(CONFIG.pythonBin),
    quantizePython: exists(CONFIG.quantizePythonBin),
    quantizeEnvOk,
    transformersPython: exists(CONFIG.transformersPythonBin),
    vllmBin: exists(CONFIG.vllmBin),
    openWebUiPort: CONFIG.openWebUiPort,
    vllmPort: CONFIG.vllmPort,
  });
});

module.exports = router;