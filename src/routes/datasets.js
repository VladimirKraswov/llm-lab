const express = require('express');
const fs = require('fs');
const { getDatasets } = require('../services/state');
const { verifyCallbackToken } = require('../services/auth');
const {
  createDatasetFromJsonl,
  createDatasetFromItems,
  previewDataset,
  deleteDataset,
  validateJsonl,
  validateItems,
} = require('../services/datasets');

const router = express.Router();

function getBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
}

router.get('/', async (_req, res) => {
  res.json(await getDatasets());
});

router.get('/:id/download', async (req, res) => {
  try {
    const datasets = await getDatasets();
    const ds = datasets.find((x) => x.id === req.params.id);

    if (!ds) {
      return res.status(404).json({ error: 'dataset not found' });
    }

    let allowed = !!req.user;

    if (!allowed) {
      const jobId = String(req.query.job_id || '').trim();
      const token =
        String(req.query.token || '').trim() ||
        getBearerToken(req);

      if (jobId && token) {
        allowed = await verifyCallbackToken(token, jobId);
      }
    }

    if (!allowed) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!ds.processedPath || !fs.existsSync(ds.processedPath)) {
      return res.status(404).json({ error: 'dataset file not found' });
    }

    const fileName = `${(ds.name || ds.id).replace(/[^a-z0-9._-]+/gi, '_')}.jsonl`;
    return res.download(ds.processedPath, fileName);
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/validate-jsonl', (req, res) => {
  try {
    const { jsonl } = req.body || {};
    if (!jsonl) return res.status(400).json({ error: 'jsonl is required' });
    res.json(validateJsonl(jsonl));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/validate-items', (req, res) => {
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items[] are required' });
    }
    res.json(validateItems(items));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/from-jsonl', async (req, res) => {
  try {
    const { name, jsonl } = req.body || {};
    if (!name || !jsonl) return res.status(400).json({ error: 'name and jsonl are required' });
    res.json(await createDatasetFromJsonl(name, jsonl));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/from-items', async (req, res) => {
  try {
    const { name, items } = req.body || {};
    if (!name || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'name and non-empty items[] are required' });
    }
    res.json(await createDatasetFromItems(name, items));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.get('/:id/preview', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
    res.json(await previewDataset(req.params.id, limit));
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    res.json(await deleteDataset(req.params.id));
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

module.exports = router;