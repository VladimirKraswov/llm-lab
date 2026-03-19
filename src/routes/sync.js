const express = require('express');
const {
  startBackgroundReconcile,
  getReconcileStatus,
} = require('../services/reconcile');

const router = express.Router();

router.get('/', (_req, res) => {
  res.json(getReconcileStatus());
});

router.post('/', (req, res) => {
  const rawReason = String(req.body?.reason || 'manual-http').trim();
  const reason = rawReason || 'manual-http';

  const result = startBackgroundReconcile({ reason });

  res.status(result.started ? 202 : 200).json(result);
});

module.exports = router;