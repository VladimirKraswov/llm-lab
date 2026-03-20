const PRESETS = [
  {
    id: 'preset_qwen25_7b',
    title: 'Qwen 2.5 7B (Standard)',
    family: 'qwen',
    logicalBaseModelId: 'Qwen/Qwen2.5-7B-Instruct',
    localModelPath: '/app',
    trainerImage: 'igortet/itk-ai-trainer-service:qwen-7b',
    dockerHubRepo: 'igortet/itk-ai-trainer-service',
    defaultShmSize: '16g',
    gpuCount: 1,
    supports: {
      qlora: true,
      lora: true,
      merge: true,
    },
    enabled: true,
  },
  {
    id: 'preset_llama3_8b',
    title: 'Llama 3 8B (Standard)',
    family: 'llama',
    logicalBaseModelId: 'meta-llama/Meta-Llama-3-8B-Instruct',
    localModelPath: '/app',
    trainerImage: 'igortet/itk-ai-trainer-service:llama-8b',
    dockerHubRepo: 'igortet/itk-ai-trainer-service',
    defaultShmSize: '16g',
    gpuCount: 1,
    supports: {
      qlora: true,
      lora: true,
      merge: true,
    },
    enabled: true,
  },
];

function getRuntimePresets() {
  return PRESETS.filter((p) => p.enabled);
}

function getRuntimePresetById(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

module.exports = {
  PRESETS,
  getRuntimePresets,
  getRuntimePresetById,
};
