const express = require('express');
const { getSettings, getRuntime, getJobs, getModelById, getLoraByJobId } = require('../services/state');
const { startVllmRuntime, stopVllmRuntime } = require('../services/runtime');
const { CONFIG } = require('../config');
const logger = require('../utils/logger');
const providers = require('../services/providers');

const router = express.Router();

router.get('/', async (_req, res) => {
  res.json(await getRuntime());
});

router.get('/providers', async (_req, res) => {
  try {
    const available = await providers.getAvailableProviders();
    const runtime = await getRuntime();
    const settings = await getSettings();

    res.json({
      available,
      selected: settings.inference.provider || 'auto',
      active: runtime.vllm?.providerResolved || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/health', async (_req, res) => {
  try {
    const runtime = await getRuntime();
    const settings = await getSettings();
    const port = runtime.vllm?.port || settings.inference.port || CONFIG.vllmPort;
    const providerId = runtime.vllm?.providerResolved || 'vllm';
    const provider = providers.PROVIDERS[providerId] || providers.PROVIDERS.vllm;

    const h = await provider.health({ port });

    res.json({
      ok: h.ok,
      raw: h.status,
      port,
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
      port: inf.port,
      maxModelLen: inf.maxModelLen,
      gpuMemoryUtilization: inf.gpuMemoryUtilization,
      tensorParallelSize: inf.tensorParallelSize,
      quantization: inf.quantization,
      dtype: inf.dtype,
      trustRemoteCode: inf.trustRemoteCode,
      enforceEager: inf.enforceEager,
      kvCacheDtype: inf.kvCacheDtype,
      maxNumSeqs: inf.maxNumSeqs,
      swapSpace: inf.swapSpace,
      baseModel: inf.model,
      activeModelId: null,
      activeModelName: inf.model,
      activeLoraId: null,
      activeLoraName: null,
      provider: inf.provider,
    });

    res.json({ ok: true, runtime });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/vllm/stop', async (_req, res) => {
  res.json({ ok: true, runtime: await stopVllmRuntime() });
});

router.get('/logs', async (req, res) => {
  try {
    const { readText } = require('../utils/fs');
    const tail = Math.max(20, Math.min(2000, Number(req.query.tail || 200)));
    const text = await readText(CONFIG.vllmLogFile, '');
    const lines = text.split('\n');

    res.json({
      logFile: CONFIG.vllmLogFile,
      content: lines.slice(-tail).join('\n'),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
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

    let modelName = job.baseModel;
    if (job.modelId) {
      const model = await getModelById(job.modelId);
      if (model) modelName = model.name;
    }

    const lora = await getLoraByJobId(jobId);
    let runtimeModelPath = job.modelId ? (await getModelById(job.modelId))?.path || job.baseModel : job.baseModel;
    let activeLoraId = null;
    let activeLoraName = null;
    let loraPath = null;
    let loraName = null;

    if (lora) {
      activeLoraId = lora.id;
      activeLoraName = lora.name;
      loraPath = lora.adapterPath;
      loraName = lora.name;
    }

    logger.info(`Using job output in runtime`, { jobId, activeLoraName });

    const runtime = await startVllmRuntime({
      model: runtimeModelPath,
      port: Number(port || inf.port || CONFIG.vllmPort),
      maxModelLen: Number(maxModelLen || inf.maxModelLen || 2048),
      gpuMemoryUtilization: Number(gpuMemoryUtilization || inf.gpuMemoryUtilization || 0.85),
      tensorParallelSize: Number(tensorParallelSize || inf.tensorParallelSize || 1),
      quantization: inf.quantization,
      dtype: inf.dtype,
      trustRemoteCode: inf.trustRemoteCode,
      enforceEager: inf.enforceEager,
      kvCacheDtype: inf.kvCacheDtype,
      maxNumSeqs: inf.maxNumSeqs,
      swapSpace: inf.swapSpace,
      baseModel: modelName,
      activeModelId: job.modelId || null,
      activeModelName: modelName,
      activeLoraId,
      activeLoraName,
      loraPath,
      loraName,
      provider: inf.provider,
    });

    res.json({
      ok: true,
      runtime,
      job,
    });
  } catch (err) {
    const errorMsg = String(err.message || err);
    logger.error(`Failed to use job output in runtime`, { error: errorMsg });
    res.status(500).json({ error: errorMsg });
  }
});

router.post('/chat', async (req, res) => {
  try {
    const runtime = await getRuntime();
    if (!runtime.vllm?.pid) {
      return res.status(400).json({ error: 'Runtime is not running' });
    }

    const providerId = runtime.vllm.providerResolved;
    const provider = providers.PROVIDERS[providerId];
    if (!provider) {
      return res.status(500).json({ error: `Active provider ${providerId} not found` });
    }

    const messages = req.body?.messages;
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: 'messages are required' });
    }

    const payload = {
      model: req.body?.model || runtime.vllm.model,
      messages,
      temperature: req.body?.temperature ?? 0.7,
      max_tokens: req.body?.max_tokens ?? 512,
      stream: !!req.body?.stream,
    };

    logger.info('Routing chat request', {
      provider: providerId,
      model: payload.model,
      stream: payload.stream,
    });

    const response = await provider.chat(runtime.vllm, payload);

    if (!response.ok) {
      const text = await response.text();
      return res.status(500).json({ error: text || 'Inference failed', provider: providerId });
    }

    if (payload.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      return res.end();
    } else {
      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        return res.json(parsed);
      } catch (e) {
        return res.status(500).json({ error: 'Invalid response from provider', raw: text });
      }
    }
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/ui', async (_req, res) => {
  const runtime = await getRuntime();
  const port = runtime.vllm?.port || CONFIG.vllmPort;

  res.json({
    openWebUI: `http://127.0.0.1:${CONFIG.openWebUiPort}`,
    vllmApi: `http://127.0.0.1:${port}/v1`,
  });
});

module.exports = router;
