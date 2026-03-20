exports.up = function(knex) {
  return knex.schema.table('jobs', (table) => {
    table.string('runtime_preset_id').nullable();
    table.string('model_local_path').nullable();
  });
};

exports.down = function(knex) {
  return knex.schema.table('jobs', (table) => {
    table.dropColumn('runtime_preset_id');
    table.dropColumn('model_local_path');
  });
};
