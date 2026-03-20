/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('jobs');
  if (hasTable) {
    const columns = await knex('jobs').columnInfo();

    await knex.schema.alterTable('jobs', (table) => {
      if (!columns.finished_at) table.timestamp('finished_at');
      if (!columns.started_at) table.timestamp('started_at');
      if (!columns.worker_id) table.string('worker_id');
      if (!columns.mode) table.string('mode').defaultTo('local');
      if (!columns.message) table.text('message');
      if (!columns.worker_type) table.string('worker_type');
      if (!columns.launch_mode) table.string('launch_mode');
      if (!columns.worker_host) table.string('worker_host');
      if (!columns.container_image) table.string('container_image');
      if (!columns.container_command) table.text('container_command');
      if (!columns.job_config_url) table.string('job_config_url');
      if (!columns.last_status_payload) table.text('last_status_payload');
      if (!columns.last_progress_payload) table.text('last_progress_payload');
      if (!columns.final_payload) table.text('final_payload');
      if (!columns.log_chunk_count) table.integer('log_chunk_count').defaultTo(0);
      if (!columns.last_log_offset) table.integer('last_log_offset').defaultTo(0);
      if (!columns.hf_repo_id_lora) table.string('hf_repo_id_lora');
      if (!columns.hf_repo_id_merged) table.string('hf_repo_id_merged');
      if (!columns.hf_repo_id_metadata) table.string('hf_repo_id_metadata');
      if (!columns.published_at) table.timestamp('published_at');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  // Irreversible repair migration
};
