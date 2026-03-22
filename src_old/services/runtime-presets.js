const { db } = require('../db');

function mapRuntimePresetRow(p) {
  if (!p) return null;

  return {
    ...p,
    logicalBaseModelId: p.logical_base_model_id,
    localModelPath: p.model_local_path,
    trainerImage: p.trainer_image,
    defaultShmSize: p.default_shm_size,
    gpuCount: p.default_gpu_count,
    supports: {
      qlora: !!p.supports_qlora,
      lora: !!p.supports_lora,
      merge: !!p.supports_merge,
      evaluation: !!p.supports_evaluation,
    },
  };
}

async function getRuntimePresets() {
  const presets = await db('runtime_presets')
    .where({ enabled: true })
    .orderBy('created_at', 'desc');

  return presets.map(mapRuntimePresetRow);
}

async function getRuntimePresetById(id) {
  const row = await db('runtime_presets').where({ id }).first();
  return mapRuntimePresetRow(row);
}

async function updateRuntimePreset(id, patch = {}) {
  const existing = await db('runtime_presets').where({ id }).first();
  if (!existing) {
    throw new Error('Runtime preset not found');
  }

  const update = {
    updated_at: new Date().toISOString(),
  };

  if (patch.title !== undefined) {
    const title = String(patch.title || '').trim();
    if (!title) {
      throw new Error('title is required');
    }
    update.title = title;
  }

  if (patch.description !== undefined) {
    update.description = patch.description == null ? '' : String(patch.description);
  }

  if (patch.enabled !== undefined) {
    update.enabled = !!patch.enabled;
  }

  await db('runtime_presets').where({ id }).update(update);
  return getRuntimePresetById(id);
}

// Initial seeding if empty
async function seedPresets() {
  const count = await db('runtime_presets').count('id as count').first();
  if (parseInt(count.count) === 0) {
    const now = new Date().toISOString();
    await db('runtime_presets').insert([
      {
        id: 'preset_qwen25_7b',
        title: 'Qwen 2.5 7B (Standard)',
        family: 'qwen',
        logical_base_model_id: 'Qwen/Qwen2.5-7B-Instruct',
        model_local_path: '/app',
        trainer_image: 'igortet/itk-ai-trainer-service:qwen-7b',
        default_shm_size: '16g',
        default_gpu_count: 1,
        supports_qlora: true,
        supports_lora: true,
        supports_merge: true,
        supports_evaluation: true,
        enabled: true,
        created_at: now,
        updated_at: now,
      },
      {
        id: 'preset_llama3_8b',
        title: 'Llama 3 8B (Standard)',
        family: 'llama',
        logical_base_model_id: 'meta-llama/Meta-Llama-3-8B-Instruct',
        model_local_path: '/app',
        trainer_image: 'igortet/itk-ai-trainer-service:llama-8b',
        default_shm_size: '16g',
        default_gpu_count: 1,
        supports_qlora: true,
        supports_lora: true,
        supports_merge: true,
        supports_evaluation: true,
        enabled: true,
        created_at: now,
        updated_at: now,
      }
    ]);
  }
}

module.exports = {
  getRuntimePresets,
  getRuntimePresetById,
  updateRuntimePreset,
  seedPresets,
};