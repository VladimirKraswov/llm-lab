exports.up = async function(knex) {
  await knex.schema
    .createTable('base_model_images', table => {
      table.string('id').primary();
      table.string('title').notNullable();
      table.string('slug').unique();
      table.text('description');
      table.string('family');
      table.string('logical_base_model_id').notNullable();
      table.string('docker_image').notNullable();
      table.string('docker_registry');
      table.string('docker_repository');
      table.string('docker_tag');
      table.string('model_local_path').defaultTo('/app');
      table.string('default_shm_size').defaultTo('16g');
      table.integer('default_gpu_count').defaultTo(1);
      table.text('cuda_notes');
      table.text('memory_notes');
      table.boolean('supports_qlora').defaultTo(true);
      table.boolean('supports_lora').defaultTo(true);
      table.boolean('supports_merge').defaultTo(true);
      table.boolean('supports_evaluation').defaultTo(true);
      table.boolean('enabled').defaultTo(true);
      table.integer('sort_order').defaultTo(0);
      table.timestamps(true, true);
    })
    .createTable('agent_build_recipes', table => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.text('description');
      table.boolean('enabled').defaultTo(true);
      table.string('base_model_image_id').references('id').inTable('base_model_images');
      table.string('base_image_override');
      table.string('trainer_context_path');
      table.string('dockerfile_path');
      table.text('build_args'); // JSON string
      table.string('target_registry');
      table.string('target_repository');
      table.string('target_tag_template');
      table.string('stable_tag').defaultTo('latest');
      table.boolean('push_enabled').defaultTo(false);
      table.string('default_runtime_preset_title');
      table.text('default_runtime_preset_description');
      table.boolean('default_runtime_preset_enabled').defaultTo(true);
      table.string('default_shm_size');
      table.integer('default_gpu_count');
      table.text('capabilities'); // JSON string
      table.timestamps(true, true);
    })
    .createTable('agent_builds', table => {
      table.string('id').primary();
      table.string('recipe_id').references('id').inTable('agent_build_recipes');
      table.string('base_model_image_id').references('id').inTable('base_model_images');
      table.string('status').defaultTo('queued');
      table.text('logs');
      table.string('resolved_base_image');
      table.string('result_image');
      table.string('pushed_image');
      table.string('immutable_tag');
      table.string('stable_tag');
      table.string('docker_hub_repo');
      table.string('digest');
      table.datetime('started_at');
      table.datetime('finished_at');
      table.text('error');
      table.string('published_runtime_preset_id');
      table.timestamps(true, true);
    })
    .createTable('runtime_presets', table => {
      table.string('id').primary();
      table.string('title').notNullable();
      table.string('family');
      table.text('description');
      table.string('logical_base_model_id').notNullable();
      table.string('base_model_image_id').references('id').inTable('base_model_images');
      table.string('source_build_id').references('id').inTable('agent_builds');
      table.string('trainer_image').notNullable();
      table.string('model_local_path').defaultTo('/app');
      table.string('default_shm_size').defaultTo('16g');
      table.integer('default_gpu_count').defaultTo(1);
      table.boolean('supports_qlora').defaultTo(true);
      table.boolean('supports_lora').defaultTo(true);
      table.boolean('supports_merge').defaultTo(true);
      table.boolean('supports_evaluation').defaultTo(true);
      table.boolean('enabled').defaultTo(true);
      table.timestamps(true, true);
    });

  // Adding columns only if they don't exist
  const hasContainerImage = await knex.schema.hasColumn('jobs', 'container_image');
  if (!hasContainerImage) {
    await knex.schema.alterTable('jobs', table => {
      table.string('container_image');
      table.string('container_command');
      table.string('job_config_url');
      table.text('pipeline');
    });
  }
};

exports.down = function(knex) {
  return knex.schema
    .alterTable('jobs', table => {
      table.dropColumn('container_image');
      table.dropColumn('container_command');
      table.dropColumn('job_config_url');
      table.dropColumn('pipeline');
    })
    .dropTable('runtime_presets')
    .dropTable('agent_builds')
    .dropTable('agent_build_recipes')
    .dropTable('base_model_images');
};
