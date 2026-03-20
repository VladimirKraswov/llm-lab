/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('users', (table) => {
      table.increments('id').primary();
      table.string('username').unique().notNullable();
      table.string('password_hash').notNullable();
      table.string('role').notNullable().defaultTo('member');
      table.timestamps(true, true);
    })
    .createTable('jobs', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('type').notNullable(); // fine-tune, synthetic-gen, remote-train
      table.string('mode').notNullable().defaultTo('local'); // local, remote
      table.string('status').notNullable().defaultTo('queued');
      table.string('current_stage');
      table.float('progress_percent').defaultTo(0);
      table.text('message');
      table.string('worker_type');
      table.string('launch_mode');
      table.string('worker_host');
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
      table.text('tags'); // comma-separated or JSON
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
      table.timestamps(true, true);
    })
    .createTable('job_events', (table) => {
      table.increments('id').primary();
      table.string('job_id').references('id').inTable('jobs').onDelete('CASCADE');
      table.string('type').notNullable();
      table.text('payload');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('job_logs', (table) => {
      table.increments('id').primary();
      table.string('job_id').references('id').inTable('jobs').onDelete('CASCADE');
      table.text('content').notNullable();
      table.integer('offset');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('job_artifacts', (table) => {
      table.increments('id').primary();
      table.string('job_id').references('id').inTable('jobs').onDelete('CASCADE');
      table.string('name').notNullable();
      table.string('type');
      table.string('url');
      table.string('path');
      table.integer('size');
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .createTable('job_callback_tokens', (table) => {
      table.string('id').primary(); // token
      table.string('job_id').references('id').inTable('jobs').onDelete('CASCADE');
      table.boolean('is_active').defaultTo(true);
      table.timestamp('created_at').defaultTo(knex.fn.now());
      table.timestamp('expires_at');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema
    .dropTableIfExists('job_callback_tokens')
    .dropTableIfExists('job_artifacts')
    .dropTableIfExists('job_logs')
    .dropTableIfExists('job_events')
    .dropTableIfExists('jobs')
    .dropTableIfExists('users');
};
