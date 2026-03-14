
const express = require('express');
const { getSettings, getRuntime, getJobs } = require('../services/state');
const { startVllmRuntime, stopVllmRuntime } = require('../services/runtime');
const { CONFIG } = require('../config');

const router = express.Router();

router.get('/', async (_req, res) => {
  res.json(await getRuntime());
});

router.get('/health', async (_req, res) => {
  try {
    const settings = await getSettings();
    const response = await fetch(`http://127.0.0.1:${settings.inference.port}/health`);
    const text = await response.text();

    res.json({
      ok: response.ok,
      raw: text,
    });
  } catch (err) {
    res.json({
      ok: false,
      raw: String(err.message || err),
    });
  }
});

router.post('/vllm/start', async (req, res) => {
  try {
    const settings = await getSettings();
    const inf = { ...settings.inference, ...(req.body || {}) };

    const runtime = await startVllmRuntime({
      model: inf.model,
      port: Number(inf.port),
      maxModelLen: Number(inf.maxModelLen),
      gpuMemoryUtilization: Number(inf.gpuMemoryUtilization),
      tensorParallelSize: Number(inf.tensorParallelSize),
      baseModel: inf.model,
      activeModelId: null,
      activeModelName: inf.model,
    });

    res.json({ ok: true, runtime });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/vllm/stop', async (_req, res) => {
  res.json({ ok: true, runtime: await stopVllmRuntime() });
});

router.post('/use-job-output', async (req, res) => {
  try {
    const { jobId, port, maxModelLen, gpuMemoryUtilization, tensorParallelSize } = req.body || {};
    if (!jobId) {
      return res.status(400).json({ error: 'jobId is required' });
    }

    const jobs = await getJobs();
    const job = jobs.find((x) => x.id === jobId);
    if (!job) {
      return res.status(404).json({ error: 'job not found' });
    }
    if (job.status !== 'completed') {
      return res.status(400).json({ error: 'job is not completed' });
    }

    const settings = await getSettings();
    const inf = settings.inference || {};

    const runtime = await startVllmRuntime({
      model: job.outputDir,
      port: Number(port || inf.port || CONFIG.vllmPort),
      maxModelLen: Number(maxModelLen || inf.maxModelLen || 2048),
      gpuMemoryUtilization: Number(gpuMemoryUtilization || inf.gpuMemoryUtilization || 0.85),
      tensorParallelSize: Number(tensorParallelSize || inf.tensorParallelSize || 1),
      baseModel: job.baseModel,
      activeModelId: job.modelId,
      activeModelName: job.name,
    });

    res.json({
      ok: true,
      runtime,
      job,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const settings = await getSettings();
    const model = req.body?.model || settings.inference.model;
    const messages = req.body?.messages;

    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'messages are required' });
    }

    const response = await fetch(`http://127.0.0.1:${settings.inference.port}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        temperature: req.body?.temperature ?? 0.7,
        max_tokens: req.body?.max_tokens ?? 512,
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      return res.status(500).json({ error: text || 'inference failed' });
    }

    try {
      return res.json(JSON.parse(text));
    } catch {
      return res.status(500).json({ error: 'invalid inference response', raw: text });
    }
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/ui', async (_req, res) => {
  res.json({
    openWebUI: `http://127.0.0.1:${CONFIG.openWebUiPort}`,
    vllmApi: `http://127.0.0.1:${CONFIG.vllmPort}/v1`,
  });
});

module.exports = router;
