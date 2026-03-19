const knex = require('knex');
const path = require('path');
const { CONFIG } = require('./config');

const dbType = process.env.DB_TYPE || 'sqlite3';

const knexConfig = {
  sqlite3: {
    client: 'sqlite3',
    connection: {
      filename: path.join(CONFIG.stateDir, 'db.sqlite'),
    },
    useNullAsDefault: true,
  },
  pg: {
    client: 'pg',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'llm_lab',
    },
  },
};

const db = knex(knexConfig[dbType] || knexConfig.sqlite3);

async function initDb() {
  console.log(`Initializing database (${dbType})...`);

  const hasUsersTable = await db.schema.hasTable('users');
  if (!hasUsersTable) {
    console.log('Creating users table...');
    await db.schema.createTable('users', (table) => {
      table.increments('id').primary();
      table.string('username').unique().notNullable();
      table.string('password_hash').notNullable();
      table.string('role').notNullable().defaultTo('member');
      table.timestamps(true, true);
    });
  } else {
    const hasRoleColumn = await db.schema.hasColumn('users', 'role');
    if (!hasRoleColumn) {
      console.log('Adding role column to users table...');
      await db.schema.alterTable('users', (table) => {
        table.string('role').notNullable().defaultTo('member');
      });
    }
  }

  // Seed admin user
  const adminUsername = 'admin';
  const adminPassword = 'restart987';
  const adminUser = await db('users').where({ username: adminUsername }).first();

  if (!adminUser) {
    console.log('Seeding admin user...');
    const bcrypt = require('bcryptjs');
    const passwordHash = bcrypt.hashSync(adminPassword, 10);
    await db('users').insert({
      username: adminUsername,
      password_hash: passwordHash,
      role: 'admin',
    });
  }
}

module.exports = { db, initDb };
