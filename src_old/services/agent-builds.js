const { db } = require('../db');
const { uid } = require('../utils/ids');
const { getBaseModelById } = require('./base-models');

// Recipes
async function getRecipes() {
  return db('agent_build_recipes').orderBy('created_at', 'desc');
}

async function getRecipeById(id) {
  const recipe = await db('agent_build_recipes').where({ id }).first();
  if (recipe) {
    recipe.build_args = recipe.build_args ? JSON.parse(recipe.build_args) : {};
    recipe.capabilities = recipe.capabilities ? JSON.parse(recipe.capabilities) : {};
  }
  return recipe;
}

async function createRecipe(data) {
  const id = uid('recipe');
  const recipe = {
    ...data,
    id,
    build_args: data.build_args ? JSON.stringify(data.build_args) : null,
    capabilities: data.capabilities ? JSON.stringify(data.capabilities) : null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db('agent_build_recipes').insert(recipe);
  return getRecipeById(id);
}

async function updateRecipe(id, data) {
  const update = {
    ...data,
    updated_at: new Date().toISOString(),
  };
  if (data.build_args) update.build_args = JSON.stringify(data.build_args);
  if (data.capabilities) update.capabilities = JSON.stringify(data.capabilities);

  await db('agent_build_recipes').where({ id }).update(update);
  return getRecipeById(id);
}

async function deleteRecipe(id) {
  return db('agent_build_recipes').where({ id }).del();
}

// Builds
async function getBuilds(recipeId = null) {
  const query = db('agent_builds').orderBy('created_at', 'desc');
  if (recipeId) query.where({ recipe_id: recipeId });
  return query;
}

async function getBuildById(id) {
  return db('agent_builds').where({ id }).first();
}

async function startBuild(recipeId) {
  const recipe = await getRecipeById(recipeId);
  if (!recipe) throw new Error('Recipe not found');

  const bmi = await getBaseModelById(recipe.base_model_image_id);

  const buildId = uid('build');
  const build = {
    id: buildId,
    recipe_id: recipeId,
    base_model_image_id: recipe.base_model_image_id,
    status: 'running',
    resolved_base_image: recipe.base_image_override || (bmi ? bmi.docker_image : null),
    started_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db('agent_builds').insert(build);

  // Mock build process
  setTimeout(async () => {
    try {
      const logs = "Starting build process...\nStep 1/5: Pulling base image...\nStep 2/5: Installing trainer environment...\nStep 3/5: Copying trainer code...\nStep 4/5: Tagging image...\nStep 5/5: Pushing to registry...\nBuild successful!";
      const resultImage = `${recipe.target_repository}:${recipe.stable_tag || 'latest'}`;

      await db('agent_builds').where({ id: buildId }).update({
        status: 'completed',
        logs,
        result_image: resultImage,
        pushed_image: recipe.push_enabled ? resultImage : null,
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      await db('agent_builds').where({ id: buildId }).update({
        status: 'failed',
        error: String(err.message || err),
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }, 2000);

  return getBuildById(buildId);
}

async function publishRuntimePreset(buildId) {
  const build = await getBuildById(buildId);
  if (!build || build.status !== 'completed') throw new Error('Build not found or not completed');

  const recipe = await getRecipeById(build.recipe_id);
  const bmi = await getBaseModelById(build.base_model_image_id);

  const presetId = uid('preset');
  const preset = {
    id: presetId,
    title: recipe.default_runtime_preset_title || `Preset for ${recipe.name}`,
    description: recipe.default_runtime_preset_description,
    family: bmi ? bmi.family : null,
    logical_base_model_id: bmi ? bmi.logical_base_model_id : (recipe.logical_base_model_id || 'unknown'),
    base_model_image_id: build.base_model_image_id,
    source_build_id: buildId,
    trainer_image: build.result_image,
    model_local_path: bmi ? bmi.model_local_path : '/app',
    default_shm_size: recipe.default_shm_size || (bmi ? bmi.default_shm_size : '16g'),
    default_gpu_count: recipe.default_gpu_count || (bmi ? bmi.default_gpu_count : 1),
    supports_qlora: bmi ? bmi.supports_qlora : true,
    supports_lora: bmi ? bmi.supports_lora : true,
    supports_merge: bmi ? bmi.supports_merge : true,
    supports_evaluation: bmi ? bmi.supports_evaluation : true,
    enabled: recipe.default_runtime_preset_enabled,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  await db('runtime_presets').insert(preset);
  await db('agent_builds').where({ id: buildId }).update({ published_runtime_preset_id: presetId });

  return preset;
}

module.exports = {
  getRecipes,
  getRecipeById,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  getBuilds,
  getBuildById,
  startBuild,
  publishRuntimePreset,
};
