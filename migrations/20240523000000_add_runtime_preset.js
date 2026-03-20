/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('jobs');
  if (hasTable) {
    const columns = await knex('jobs').columnInfo();

    await knex.schema.alterTable('jobs', (table) => {
      if (!columns.runtime_preset_id) table.string('runtime_preset_id');
      if (!columns.model_local_path) table.string('model_local_path');
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.alterTable('jobs', (table) => {
    table.dropColumn('runtime_preset_id');
    table.dropColumn('model_local_path');
  });
};
