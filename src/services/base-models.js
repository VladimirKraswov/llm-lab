const { db } = require('../db');
const { uid } = require('../utils/ids');

async function getBaseModels() {
  return db('base_model_images').orderBy('sort_order', 'asc');
}

async function getBaseModelById(id) {
  return db('base_model_images').where({ id }).first();
}

async function createBaseModel(data) {
  const id = uid('bmi');
  const model = {
    ...data,
    id,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db('base_model_images').insert(model);
  return getBaseModelById(id);
}

async function updateBaseModel(id, data) {
  const update = {
    ...data,
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
