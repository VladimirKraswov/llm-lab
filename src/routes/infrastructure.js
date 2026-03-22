const express = require('express');
const {
  getBaseModels,
  getBaseModelById,
  createBaseModel,
  updateBaseModel,
  deleteBaseModel
} = require('../services/base-models');
const {
  getRecipes,
  getRecipeById,
  createRecipe,
  updateRecipe,
  deleteRecipe,
  getBuilds,
  getBuildById,
  startBuild,
  publishRuntimePreset
} = require('../services/agent-builds');
const { toCamelCase, toSnakeCase } = require('../utils/ids');

const router = express.Router();

// Base Models
router.get('/base-models', async (req, res) => {
  try {
    const models = await getBaseModels();
    res.json(toCamelCase(models));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/base-models', async (req, res) => {
  try {
    const data = toSnakeCase(req.body);
    const model = await createBaseModel(data);
    res.json(toCamelCase(model));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.get('/base-models/:id', async (req, res) => {
  try {
    const model = await getBaseModelById(req.params.id);
    if (!model) return res.status(404).json({ error: 'Base model not found' });
    res.json(toCamelCase(model));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.put('/base-models/:id', async (req, res) => {
  try {
    const data = toSnakeCase(req.body);
    const model = await updateBaseModel(req.params.id, data);
    res.json(toCamelCase(model));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.delete('/base-models/:id', async (req, res) => {
  try {
    await deleteBaseModel(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Recipes
router.get('/recipes', async (req, res) => {
  try {
    const recipes = await getRecipes();
    res.json(toCamelCase(recipes));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.post('/recipes', async (req, res) => {
  try {
    const data = toSnakeCase(req.body);
    const recipe = await createRecipe(data);
    res.json(toCamelCase(recipe));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.get('/recipes/:id', async (req, res) => {
  try {
    const recipe = await getRecipeById(req.params.id);
    if (!recipe) return res.status(404).json({ error: 'Recipe not found' });
    res.json(toCamelCase(recipe));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.put('/recipes/:id', async (req, res) => {
  try {
    const data = toSnakeCase(req.body);
    const recipe = await updateRecipe(req.params.id, data);
    res.json(toCamelCase(recipe));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.delete('/recipes/:id', async (req, res) => {
  try {
    await deleteRecipe(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Builds
router.get('/builds', async (req, res) => {
  try {
    const builds = await getBuilds(req.query.recipeId);
    res.json(toCamelCase(builds));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

router.get('/builds/:id', async (req, res) => {
  try {
    const build = await getBuildById(req.params.id);
    if (!build) return res.status(404).json({ error: 'Build not found' });
    res.json(toCamelCase(build));
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// Старый маршрут — оставляем
router.post('/recipes/:id/build', async (req, res) => {
  try {
    const build = await startBuild(req.params.id);
    res.json(toCamelCase(build));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

// Новый совместимый маршрут под ожидание фронта
router.post('/builds', async (req, res) => {
  try {
    const recipeId = String(req.body?.recipeId || req.body?.recipe_id || '').trim();

    if (!recipeId) {
      return res.status(400).json({ error: 'recipeId is required' });
    }

    const build = await startBuild(recipeId);
    res.json(toCamelCase(build));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

router.post('/builds/:id/publish-runtime-preset', async (req, res) => {
  try {
    const preset = await publishRuntimePreset(req.params.id);
    res.json(toCamelCase(preset));
  } catch (err) {
    res.status(400).json({ error: String(err.message || err) });
  }
});

module.exports = router;