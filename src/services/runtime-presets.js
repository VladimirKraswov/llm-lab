const RUNTIME_PRESETS = [
  {
    id: 'qwen25-7b-instruct',
    title: 'Qwen 2.5 7B Instruct',
    family: 'qwen',
    logicalBaseModelId: 'Qwen/Qwen2.5-7B-Instruct',
    localModelPath: '/app',
    trainerImage: 'igortet/itk-ai-trainer-service:qwen-7b',
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
    id: 'llama31-8b-instruct',
    title: 'Llama 3.1 8B Instruct',
    family: 'llama',
    logicalBaseModelId: 'meta-llama/Llama-3.1-8B-Instruct',
    localModelPath: '/app',
    trainerImage: 'igortet/itk-ai-trainer-service:llama-8b',
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
  return RUNTIME_PRESETS.filter(p => p.enabled);
}

function getRuntimePresetById(id) {
  return RUNTIME_PRESETS.find(p => p.id === id);
}

module.exports = {
  getRuntimePresets,
  getRuntimePresetById,
};
