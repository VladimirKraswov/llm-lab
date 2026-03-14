const fs = require('fs');
const fsp = require('fs/promises');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true });
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(file, data) {
  await fsp.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function readText(file, fallback = '') {
  try {
    return await fsp.readFile(file, 'utf8');
  } catch {
    return fallback;
  }
}

async function removeFile(file) {
  try {
    await fsp.unlink(file);
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err;
  }
}

module.exports = {
  exists,
  ensureDir,
  readJson,
  writeJson,
  readText,
  removeFile,
};
