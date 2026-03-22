const { db } = require('../db');
const { uid } = require('../utils/ids');

function toBool(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return !!value;
}

function normalizeBaseModelInput(data = {}) {
  const supports = data.supports && typeof data.supports === 'object'
    ? data.supports
    : null;

  const normalized = {
    ...data,
  };

  if (supports) {
    normalized.supports_qlora = toBool(
      supports.qlora,
      toBool(data.supports_qlora, true)
    );
    normalized.supports_lora = toBool(
      supports.lora,
      toBool(data.supports_lora, true)
    );
    normalized.supports_merge = toBool(
      supports.merge,
      toBool(data.supports_merge, true)
    );
    normalized.supports_evaluation = toBool(
      supports.evaluation,
      toBool(data.supports_evaluation, true)
    );
  } else {
    normalized.supports_qlora = toBool(data.supports_qlora, true);
    normalized.supports_lora = toBool(data.supports_lora, true);
    normalized.supports_merge = toBool(data.supports_merge, true);
    normalized.supports_evaluation = toBool(data.supports_evaluation, true);
  }

  delete normalized.supports;

  return normalized;
}

function serializeBaseModel(row) {
  if (!row) return null;

  return {
    ...row,
    supports: {
      qlora: !!row.supports_qlora,
      lora: !!row.supports_lora,
      merge: !!row.supports_merge,
      evaluation: !!row.supports_evaluation,
    },
  };
}

async function getBaseModels() {
  const rows = await db('base_model_images').orderBy('sort_order', 'asc');
  return rows.map(serializeBaseModel);
}

async function getBaseModelById(id) {
  const row = await db('base_model_images').where({ id }).first();
  return serializeBaseModel(row);
}

async function createBaseModel(data) {
  const id = uid('bmi');

  const normalized = normalizeBaseModelInput(data);
  const model = {
    ...normalized,
    id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db('base_model_images').insert(model);
  return getBaseModelById(id);
}

async function updateBaseModel(id, data) {
  const normalized = normalizeBaseModelInput(data);
  const update = {
    ...normalized,
    updated_at: new Date().toISOString(),
  };

  await db('base_model_images').where({ id }).update(update);
  return getBaseModelById(id);
}

async function deleteBaseModel(id) {
  return db('base_model_images').where({ id }).del();
}

module.exports = {
  getBaseModels,
  getBaseModelById,
  createBaseModel,
  updateBaseModel,
  deleteBaseModel,
};