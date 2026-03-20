/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function(knex) {
  return knex.schema
    .createTable('workers', (table) => {
      table.string('id').primary();
      table.string('name').notNullable();
      table.string('status').notNullable().defaultTo('offline'); // online, busy, offline
      table.string('token').unique().notNullable();
      table.text('resources'); // JSON: gpus, vram, cpu, ram, disk
      table.text('labels'); // JSON: generic metadata/tags
      table.string('host_ip');
      table.timestamp('last_heartbeat');
      table.timestamps(true, true);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function(knex) {
  return knex.schema.dropTableIfExists('workers');
};
