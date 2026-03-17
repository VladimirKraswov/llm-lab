const express = require('express');
const fs = require('fs');
const {
  getSettings,
  getLoras,
  getLoraById,
  renameLora,
  removeLora,
  getModelById,
} = require('../services/state');
const {
  registerLoraFromJob,
  ensureMergedLora,
  packageMergedLora,
  buildMergedLora,
  getMergeOptionsInfo,
  getMergeLogs,
  cancelMergedLoraBuild,
} = require('../services/loras');
const { startVllmRuntime, stopVllmRuntime } = require('../services/runtime');
const { emitEvent } = require('../services/events');
const { CONFIG } = require('../config');

const router = express.Router();

router.get('/', async (_req, res) => {
  res.json(await getLoras());
});

router.get('/merge-options', async (_req, res) => {
  try {
    res.json(await getMergeOptionsInfo());
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id', async (req, res) => {
  const item = await getLoraById(req.params.id);
  if (!item) return res.status(404).json({ error: 'lora not found' });
  res.json(item);
});

router.get('/:id/merge-logs', async (req, res) => {
  try {
    const tail = Math.max(20, Math.min(2000, Number(req.query.tail || 200)));
    res.json(await getMergeLogs(req.params.id, tail));
  } catch (err) {
    res.status(404).json({ error: String(err.message || err) });
  }
});

router.post('/from-job', async (req, res) => {
  try {
    const { jobId, name } = req.body || {};
    res.json(await registerLoraFromJob(jobId, name));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const item = await renameLora(req.params.id, String(name).trim());
    emitEvent('lora_updated', item);
    res.json(item);
  } catch (err) {
    const message = String(err.message || err);
    res.status(message.includes('not found') ? 404 : 500).json({ error: message });
  }
});

router.post('/:id/build-merged', async (req, res) => {
  try {
    const item = await buildMergedLora(req.params.id, req.body || {});
    res.json({
      ok: true,
      lora: item,
    });
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/cancel-merge', async (req, res) => {
  try {
    res.json(await cancelMergedLoraBuild(req.params.id));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/:id/package', async (req, res) => {
  try {
    const item = await packageMergedLora(req.params.id);
    res.json({
      ok: true,
      lora: item,
      downloadPath: `/loras/${item.id}/package/download`,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/:id/package/download', async (req, res) => {
  const item = await getLoraById(req.params.id);
  if (!item || !item.packagePath || !fs.existsSync(item.packagePath)) {
    return res.status(404).json({ error: 'package not found' });
  }
  res.download(item.packagePath, `${item.name}.tar.gz`);
});

router.post('/:id/activate', async (req, res) => {
  try {
    const item = await getLoraById(req.params.id);
    if (!item) return res.status(404).json({ error: 'lora not found' });
    if (item.status !== 'ready') return res.status(400).json({ error: 'lora is not ready' });

    const settings = await getSettings();
    const inf = { ...settings.inference, ...(req.body || {}) };

    await stopVllmRuntime();

    let baseModelName = item.baseModelName;
    let baseModelPath = item.baseModelRef;

    if (item.baseModelId) {
      const model = await getModelById(item.baseModelId);
      if (model) {
        baseModelName = model.name;
        baseModelPath = model.path;
      }
    }

    const runtime = await startVllmRuntime({
      model: baseModelPath,
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
      baseModel: baseModelName,
      activeModelId: item.baseModelId || null,
      activeModelName: baseModelName || null,
      activeLoraId: item.id,
      activeLoraName: item.name,
      loraPath: item.adapterPath,
      loraName: item.name,
    });

    emitEvent('lora_activated', {
      loraId: item.id,
      loraName: item.name,
      runtime,
    });

    res.json({
      ok: true,
      lora: item,
      runtime,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/deactivate', async (_req, res) => {
  try {
    const settings = await getSettings();
    const inf = settings.inference || {};

    await stopVllmRuntime();
    const runtime = await startVllmRuntime({
      model: inf.model || settings.baseModel,
      port: Number(inf.port || CONFIG.vllmPort),
      maxModelLen: Number(inf.maxModelLen || 2048),
      gpuMemoryUtilization: Number(inf.gpuMemoryUtilization || 0.85),
      tensorParallelSize: Number(inf.tensorParallelSize || 1),
      baseModel: settings.baseModel,
      activeModelId: null,
      activeModelName: null,
      activeLoraId: null,
      activeLoraName: null,
    });

    emitEvent('lora_deactivated', runtime);
    res.json({ ok: true, runtime });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await removeLora(req.params.id);
    emitEvent('lora_deleted', { id: req.params.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

module.exports = router;