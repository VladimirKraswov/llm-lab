const logger = require('../../utils/logger');
const vllm = require('./vllm');
const transformers = require('./transformers');

const PROVIDERS = {
  vllm,
  transformers,
};

async function getAvailableProviders() {
  const result = [
    {
      id: 'auto',
      label: 'Auto',
      description: 'Automatically select the best provider for the model',
      available: true
    }
  ];

  for (const p of Object.values(PROVIDERS)) {
    const availability = await p.isAvailable();
    result.push({
      id: p.id,
      label: p.label,
      description: p.description,
      available: availability.available,
      reason: availability.reason || null,
    });
  }

  return result;
}

async function resolveProvider(requestedId, modelInfo) {
  const available = await getAvailableProviders();

  let targetId = requestedId;
  if (!targetId || targetId === 'auto') {
    // Auto-selection logic
    if (modelInfo.modelType === 'mixtral' && modelInfo.quantization === 'awq') {
      const trans = available.find(p => p.id === 'transformers');
      if (trans && trans.available) {
        targetId = 'transformers';
      } else {
        targetId = 'vllm';
      }
    } else {
      targetId = 'vllm';
    }
  }

  const provider = PROVIDERS[targetId];
  if (!provider) {
    throw new Error(`Provider ${targetId} not found`);
  }

  const availability = await provider.isAvailable();
  if (!availability.available) {
    // If auto selected a provider that is not available, we have a problem.
    // In resolveProvider, we should probably fail if manual choice is unavailable,
    // but if auto choice is unavailable, maybe fallback?
    // But the requirement says: "если transformers unavailable, не пытаться его стартовать молча"

    if (requestedId && requestedId !== 'auto') {
        throw new Error(`Provider ${targetId} is not available: ${availability.reason}`);
    } else {
        // Auto-selection fallback
        if (targetId === 'transformers') {
            logger.warn('Preferred provider transformers unavailable, falling back to vllm', { reason: availability.reason });
            const vllmProv = PROVIDERS['vllm'];
            const vllmAvail = await vllmProv.isAvailable();
            if (!vllmAvail.available) {
                throw new Error(`No available providers. vLLM: ${vllmAvail.reason}, Transformers: ${availability.reason}`);
            }
            targetId = 'vllm';
        } else {
            throw new Error(`Provider ${targetId} is not available: ${availability.reason}`);
        }
    }
  }

  const resolvedProvider = PROVIDERS[targetId];
  const compatibility = await resolvedProvider.resolveCompatibility(modelInfo);

  return {
    provider: resolvedProvider,
    compatibility,
  };
}

module.exports = {
  PROVIDERS,
  getAvailableProviders,
  resolveProvider,
};
