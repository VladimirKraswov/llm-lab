const express = require('express');
const { getModels, getModelById, getSettings } = require('../services/state');
const { downloadModel, deleteModel, getModelLogs } = require('../services/models');
const { startVllmRuntime, stopVllmRuntime } = require('../services/runtime');
const { CONFIG } = require('../config');

const router = express.Router();

router.get('/', async (_req, res) => {
  res.json(await getModels());
});

router.get('/:id', async (req, res) => {
  const item = await getModelById(req.params.id);
  if (!item) return res.status(404).json({ error: 'model not found' });
  res.json(item);
});

router.get('/:id/logs', async (req, res) => {
  try {
    const tail = Math.max(20, Math.min(2000, Number(req.query.tail || 200)));
    res.json(await getModelLogs(req.params.id, tail));
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

router.post('/download', async (req, res) => {
  try {
    const { repoId, name } = req.body || {};
    res.json(await downloadModel({ repoId, name }));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/activate', async (req, res) => {
  try {
    const item = await getModelById(req.params.id);
    if (!item) return res.status(404).json({ error: 'model not found' });
    if (item.status !== 'ready') return res.status(400).json({ error: 'model is not ready' });

    const settings = await getSettings();
    const inf = { ...settings.inference, ...(req.body || {}) };

    await stopVllmRuntime();

    const runtime = await startVllmRuntime({
      model: item.path,
      port: Number(inf.port || CONFIG.vllmPort),
      maxModelLen: Number(inf.maxModelLen || 2048),
      gpuMemoryUtilization: Number(inf.gpuMemoryUtilization || 0.85),
      tensorParallelSize: Number(inf.tensorParallelSize || 1),
      baseModel: item.name,
      activeModelId: item.id,
      activeModelName: item.name,
      activeLoraId: null,
      activeLoraName: null,
    });

    res.json({ ok: true, model: item, runtime });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    res.json(await deleteModel(req.params.id));
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

module.exports = router;