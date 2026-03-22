const { getModels, getSettings } = require('./state');
const { startRuntime, stopRuntime } = require('./runtime');
const providers = require('./providers');
const logger = require('../utils/logger');

const BENCHMARK_PROMPTS = [
  "Explain quantum computing in three sentences.",
  "Write a short poem about a rainy day.",
  "What are the benefits of using AWQ quantization?"
];

async function runBenchmark(modelId) {
  const models = await getModels();
  const model = models.find(m => m.id === modelId);
  if (!model) throw new Error('Model not found');
  if (model.status !== 'ready') throw new Error('Model is not ready');

  logger.info('Starting benchmark for model', { modelId, name: model.name });

  const runtime = await startRuntime({
    model: model.path,
    activeModelId: model.id,
    activeModelName: model.name
  });

  const providerId = runtime.providerResolved || 'vllm';
  const provider = providers.PROVIDERS[providerId];

  const results = [];

  for (const prompt of BENCHMARK_PROMPTS) {
    const startTime = Date.now();
    const response = await provider.chat(runtime, {
      model: model.path,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 128,
      temperature: 0,
      stream: false
    });

    const data = await response.json();
    const duration = (Date.now() - startTime) / 1000;
    const tokens = data.usage?.completion_tokens || 0;
    const tps = tokens / duration;

    results.push({
      prompt,
      tokens,
      duration,
      tps
    });
  }

  const avgTps = results.reduce((acc, r) => acc + r.tps, 0) / results.length;

  return {
    modelId,
    modelName: model.name,
    quantization: model.quantization || 'none',
    avgTps,
    details: results
  };
}

module.exports = { runBenchmark };
