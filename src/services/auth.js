const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { CONFIG } = require('../config');
const { uid } = require('../utils/ids');

const JWT_SECRET = process.env.JWT_SECRET || 'llm-lab-super-secret-key';
const JWT_EXPIRES_IN = '7d';

if (CONFIG.requireJwtSecret && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'llm-lab-super-secret-key')) {
  throw new Error('JWT_SECRET is required and must not be the default value in production/hardened mode.');
}

async function registerUser(username, password, role = 'member') {
  const passwordHash = await bcrypt.hash(password, 10);
  const [userId] = await db('users').insert({
    username,
    password_hash: passwordHash,
    role,
  });
  return { id: userId, username, role };
}

async function findUserByUsername(username) {
  return db('users').where({ username }).first();
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

async function generateCallbackToken(jobId) {
  const token = uid('cb');
  await db('job_callback_tokens').insert({
    id: token,
    job_id: jobId,
    is_active: true,
  });
  return token;
}

async function verifyCallbackToken(token, jobId) {
  const record = await db('job_callback_tokens')
    .where({ id: token, job_id: jobId, is_active: true })
    .first();
  return !!record;
}

module.exports = {
  registerUser,
  findUserByUsername,
  verifyPassword,
  generateToken,
  verifyToken,
  generateCallbackToken,
  verifyCallbackToken,
};
