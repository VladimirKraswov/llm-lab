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
    migrations: {
      directory: path.join(__dirname, '..', 'migrations'),
    },
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
    migrations: {
      directory: path.join(__dirname, '..', 'migrations'),
    },
  },
};

const db = knex(knexConfig[dbType] || knexConfig.sqlite3);

async function initDb() {
  console.log(`Initializing database (${dbType})...`);

  // Run migrations
  console.log('Running migrations...');
  await db.migrate.latest();

  // Seed admin user
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'restart987';

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
