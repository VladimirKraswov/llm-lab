const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../config');

const LOG_FILE = path.join(CONFIG.workspace, 'system.log');

function log(level, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta,
  };

  const line = JSON.stringify(entry) + '\n';

  // Console output for dev
  const color = {
    info: '\x1b[32m',
    warn: '\x1b[33m',
    error: '\x1b[31m',
    debug: '\x1b[34m',
  }[level] || '';
  const reset = '\x1b[0m';
  console.log(`${new Date().toISOString()} ${color}${level.toUpperCase()}${reset}: ${message}`, Object.keys(meta).length ? meta : '');

  try {
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch (err) {
    console.error('Failed to write to log file:', err);
  }
}

module.exports = {
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
  LOG_FILE,
};
