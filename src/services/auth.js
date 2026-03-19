const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'llm-lab-super-secret-key';
const JWT_EXPIRES_IN = '7d';

async function registerUser(username, password) {
  const passwordHash = await bcrypt.hash(password, 10);
  const [userId] = await db('users').insert({
    username,
    password_hash: passwordHash,
  });
  return { id: userId, username };
}

async function findUserByUsername(username) {
  return db('users').where({ username }).first();
}

async function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
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

module.exports = {
  registerUser,
  findUserByUsername,
  verifyPassword,
  generateToken,
  verifyToken,
};
