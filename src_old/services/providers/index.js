const logger = require('../../utils/logger');
const vllm = require('./vllm');
const transformers = require('./transformers');

const PROVIDERS = {
  vllm,
  transformers,
};

function getProviderCapabilities(provider) {
  return {
    experimental: false,
    supportsStreaming: true,
    supportsLora: true,
    supportsAwq: true,
    ...(provider.capabilities || {}),
  };
}

async function getAvailableProviders() {
  const result = [
    {
      id: 'auto',
      label: 'Auto',
      description: 'Use vLLM by default and only fall back when needed',
      available: true,
      capabilities: {
        experimental: false,
        supportsStreaming: true,
        supportsLora: true,
        supportsAwq: true,
      },
    },
  ];

  for (const p of Object.values(PROVIDERS)) {
    const availability = await p.isAvailable();
    result.push({
      id: p.id,
      label: p.label,
      description: p.description,
      available: availability.available,
      reason: availability.reason || null,
      capabilities: getProviderCapabilities(p),
    });
  }

  return result;
}

async function resolveProvider(requestedId, modelInfo) {
  const available = await getAvailableProviders();

  let targetId = requestedId;
  if (!targetId || targetId === 'auto') {
    targetId = 'vllm';
  }

  let provider = PROVIDERS[targetId];
  if (!provider) {
    throw new Error(`Provider ${targetId} not found`);
  }

  let availability = await provider.isAvailable();
  if (!availability.available) {
    if (requestedId && requestedId !== 'auto') {
      throw new Error(`Provider ${targetId} is not available: ${availability.reason}`);
    }

    if (targetId === 'vllm') {
      const trans = available.find((p) => p.id === 'transformers');
      if (trans?.available) {
        logger.warn('vLLM unavailable, falling back to transformers', {
          reason: availability.reason,
        });
        targetId = 'transformers';
        provider = PROVIDERS[targetId];
      } else {
        throw new Error(
          `No available providers. vLLM: ${availability.reason}; Transformers: ${trans?.reason || 'unavailable'}`
        );
      }
    } else {
      throw new Error(`Provider ${targetId} is not available: ${availability.reason}`);
    }
  }

  const compatibility = await provider.resolveCompatibility(modelInfo);

  return {
    provider,
    compatibility,
    capabilities: getProviderCapabilities(provider),
  };
}

module.exports = {
  PROVIDERS,
  getAvailableProviders,
  resolveProvider,
  getProviderCapabilities,
};