const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getModels, getModelById, getSettings } = require('../services/state');
const { downloadModel, deleteModel, getModelLogs, quantizeModel } = require('../services/models');
const { startVllmRuntime, stopVllmRuntime } = require('../services/runtime');
const { runBenchmark } = require('../services/benchmarks');
const { CONFIG } = require('../config');

const router = express.Router();

router.get('/', async (_req, res) => {
  const models = await getModels();

  // Backfill metadata for models missing it
  const { getModelMetadata } = require('../utils/model-meta');
  const { upsertModel } = require('../services/state');

  const updatedModels = await Promise.all(models.map(async (m) => {
    if (m.status === 'ready' && (!m.sizeHuman || !m.vramEstimate)) {
      const meta = getModelMetadata(m.path);
      return await upsertModel({ ...m, ...meta });
    }
    return m;
  }));

  res.json(updatedModels);
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
    const { repoId, name, tryQuantized } = req.body || {};
    res.json(await downloadModel({ repoId, name, tryQuantized }));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/quantize', async (req, res) => {
  try {
    const { modelId, method, name, datasetPath, numSamples, maxSeqLen, bits, groupSize, sym } = req.body || {};
    res.json(await quantizeModel({ modelId, method, name, datasetPath, numSamples, maxSeqLen, bits, groupSize, sym }));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/benchmark', async (req, res) => {
  try {
    res.json(await runBenchmark(req.params.id));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
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
      quantization: inf.quantization,
      dtype: inf.dtype,
      trustRemoteCode: inf.trustRemoteCode,
      enforceEager: inf.enforceEager,
      kvCacheDtype: inf.kvCacheDtype,
      maxNumSeqs: inf.maxNumSeqs,
      swapSpace: inf.swapSpace,
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

router.get('/:id/download', async (req, res) => {
  const item = await getModelById(req.params.id);
  if (!item || !item.path || !fs.existsSync(item.path)) {
    return res.status(404).json({ error: 'model not found or not ready' });
  }

  // Models are directories, so we need to tar them
  const archiveName = `${item.name.replace(/[^a-z0-9]/gi, '_')}.tar.gz`;
  res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);
  res.setHeader('Content-Type', 'application/gzip');

  const tar = spawn('tar', ['-cz', '-C', path.dirname(item.path), path.basename(item.path)]);
  tar.stdout.pipe(res);

  res.on('close', () => {
    if (tar.exitCode === null) {
      tar.kill('SIGKILL');
    }
  });
});

module.exports = router;