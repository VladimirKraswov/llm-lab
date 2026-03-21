const { initDb } = require('./src/db');
const baseModels = require('./src/services/base-models');
const agentBuilds = require('./src/services/agent-builds');
const runtimePresets = require('./src/services/runtime-presets');

async function test() {
  console.log('--- Testing Infrastructure Logic ---');
  await initDb();

  console.log('\n1. Testing Base Models...');
  const bm = await baseModels.createBaseModel({
    title: 'Test Model',
    logical_base_model_id: 'test/model',
    docker_image: 'test/image',
    model_local_path: '/test'
  });
  console.log('Created:', bm.id, bm.title);

  const allBm = await baseModels.getBaseModels();
  console.log('Total base models:', allBm.length);

  console.log('\n2. Testing Recipes...');
  const recipe = await agentBuilds.createRecipe({
    name: 'Test Recipe',
    base_model_image_id: bm.id,
    target_repository: 'test/repo',
    target_tag_template: 'test-{{timestamp}}'
  });
  console.log('Created recipe:', recipe.id, recipe.name);

  console.log('\n3. Testing Builds...');
  const build = await agentBuilds.startBuild(recipe.id);
  console.log('Started build:', build.id, build.status);

  // Wait for mock build
  await new Promise(r => setTimeout(r, 2500));

  const finishedBuild = await agentBuilds.getBuildById(build.id);
  console.log('Finished build status:', finishedBuild.status);
  console.log('Result image:', finishedBuild.result_image);

  console.log('\n4. Testing Runtime Presets...');
  const preset = await agentBuilds.publishRuntimePreset(finishedBuild.id);
  console.log('Published preset:', preset.id, preset.title);

  const allPresets = await runtimePresets.getRuntimePresets();
  console.log('Total active presets:', allPresets.length);

  const found = await runtimePresets.getRuntimePresetById(preset.id);
  console.log('Found preset by ID:', found ? 'Yes' : 'No');

  console.log('\n--- Infrastructure Test Complete ---');
  process.exit(0);
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
