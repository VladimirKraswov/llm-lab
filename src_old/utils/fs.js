const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

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

function toJsonText(data) {
  return `${JSON.stringify(data, null, 2)}\n`;
}

async function writeFileAtomic(file, content) {
  await ensureDir(path.dirname(file));

  const tempFile = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;

  const fh = await fsp.open(tempFile, 'w', 0o600);
  try {
    await fh.writeFile(content, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }

  await fsp.rename(tempFile, file);
}

async function readJsonCandidate(file) {
  try {
    const raw = await fsp.readFile(file, 'utf8');

    if (!String(raw).trim()) {
      return { ok: false, reason: 'empty', value: null, text: raw };
    }

    return {
      ok: true,
      reason: 'ok',
      value: JSON.parse(raw),
      text: raw,
    };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { ok: false, reason: 'missing', value: null, text: '' };
    }

    return {
      ok: false,
      reason: 'invalid',
      value: null,
      text: '',
      error: err,
    };
  }
}

async function readJson(file, fallback = null) {
  const primary = await readJsonCandidate(file);
  if (primary.ok) return primary.value;

  const backupFile = `${file}.bak`;
  const backup = await readJsonCandidate(backupFile);

  if (backup.ok) {
    try {
      await writeFileAtomic(file, backup.text || toJsonText(backup.value));
    } catch {
      // ignore repair errors here
    }
    return backup.value;
  }

  return fallback;
}

async function ensureJsonFile(file, defaultValue) {
  const primary = await readJsonCandidate(file);
  const backupFile = `${file}.bak`;

  if (primary.ok) {
    if (!exists(backupFile)) {
      try {
        await writeFileAtomic(backupFile, primary.text || toJsonText(primary.value));
      } catch {
        // ignore backup creation failure
      }
    }
    return primary.value;
  }

  const backup = await readJsonCandidate(backupFile);
  if (backup.ok) {
    try {
      await writeFileAtomic(file, backup.text || toJsonText(backup.value));
    } catch {
      // ignore repair failure
    }
    return backup.value;
  }

  await writeJson(file, defaultValue);
  return defaultValue;
}

async function writeJson(file, data) {
  const text = toJsonText(data);
  const backupFile = `${file}.bak`;

  await writeFileAtomic(file, text);

  try {
    await writeFileAtomic(backupFile, text);
  } catch {
    // primary already written, backup failure is non-fatal
  }
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

async function resetFile(file) {
  try {
    await fsp.rm(file, { force: true });
  } catch {}
}

module.exports = {
  exists,
  ensureDir,
  ensureJsonFile,
  readJson,
  writeJson,
  readText,
  removeFile,
  resetFile,
};