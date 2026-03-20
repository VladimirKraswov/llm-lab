/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('username').unique().notNullable();
      table.string('password_hash').notNullable();
      table.string('role').notNullable().defaultTo('member');
      table.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('jobs'))) {
    await knex.schema.createTable('jobs', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('type').notNullable();
      table.string('mode').notNullable().defaultTo('local');
      table.string('status').notNullable().defaultTo('queued');
      table.string('current_stage');
      table.float('progress_percent').defaultTo(0);
      table.text('message');
      table.string('worker_type');
      table.string('launch_mode');
      table.string('worker_host');
      table.string('worker_id');
      table.string('container_image');
      table.text('container_command');
      table.string('job_config_url');
      table.text('last_status_payload');
      table.text('last_progress_payload');
      table.text('final_payload');
      table.string('log_file');
      table.integer('log_chunk_count').defaultTo(0);
      table.integer('last_log_offset').defaultTo(0);
      table.string('hf_repo_id_lora');
      table.string('hf_repo_id_merged');
      table.string('hf_repo_id_metadata');
      table.timestamp('published_at');
      table.text('error');
      table.text('tags');
      table.text('notes');
      table.text('params_snapshot');
      table.text('dataset_snapshot');
      table.text('model_snapshot');
      table.text('env_snapshot');
      table.text('summary_metrics');
      table.string('dataset_id');
      table.string('model_id');
      table.string('base_model');
      table.string('output_dir');
      table.integer('pid');
      table.string('config_path');
      table.timestamp('started_at');
      table.timestamp('finished_at');
      table.timestamps(true, true);
    });
  }

  if (!(await knex.schema.hasTable('job_events'))) {
    await knex.schema.createTable('job_events', (table) => {
      table.increments('id').primary();
      table.string('job_id').references('id').inTable('jobs').onDelete('CASCADE');
      table.string('type').notNullable();
      table.text('payload');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('job_logs'))) {
    await knex.schema.createTable('job_logs', (table) => {
      table.increments('id').primary();
      table.string('job_id').references('id').inTable('jobs').onDelete('CASCADE');
      table.text('content').notNullable();
      table.integer('offset');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('job_artifacts'))) {
    await knex.schema.createTable('job_artifacts', (table) => {
      table.increments('id').primary();
      table.string('job_id').references('id').inTable('jobs').onDelete('CASCADE');
      table.string('name').notNullable();
      table.string('type');
      table.string('url');
      table.string('path');
      table.integer('size');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }

  if (!(await knex.schema.hasTable('job_callback_tokens'))) {
    await knex.schema.createTable('job_callback_tokens', (table) => {
      table.string('id').primary();
      table.string('job_id').references('id').inTable('jobs').onDelete('CASCADE');
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('expires_at');
    });
  }
};

exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('job_callback_tokens')
    .dropTableIfExists('job_artifacts')
    .dropTableIfExists('job_logs')
    .dropTableIfExists('job_events')
    .dropTableIfExists('jobs')
    .dropTableIfExists('users');
};
