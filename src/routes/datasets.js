// src/routes/datasets.js

const express = require('express');
const { getDatasets } = require('../services/state');
const {
  createDatasetFromJsonl,
  createDatasetFromItems,
  previewDataset,
  deleteDataset,
  validateJsonl,
  validateItems,
} = require('../services/datasets');

const router = express.Router();

router.get('/', async (_req, res) => {
  res.json(await getDatasets());
});

router.post('/validate-jsonl', async (req, res) => {
  try {
    const { jsonl } = req.body || {};
    if (!jsonl) return res.status(400).json({ error: 'jsonl is required' });
    res.json(await validateJsonl(jsonl));
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