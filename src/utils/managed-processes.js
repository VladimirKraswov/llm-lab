const fs = require('fs/promises');
const { CONFIG } = require('../config');
const { isPidRunning, killProcessGroup } = require('./proc');
const { nowIso } = require('./ids');
const logger = require('./logger');

const locks = new Map();

async function withLock(key, fn) {
  const previous = locks.get(key) || Promise.resolve();
  const next = (async () => {
    try {
      await previous;
    } catch {
      // ignore previous errors
    }
    return fn();
  })();

  locks.set(key, next);
  next.finally(() => {
    if (locks.get(key) === next) {
      locks.delete(key);
    }
  });

  return next;
}

async function readRegistry() {
  try {
    const raw = await fs.readFile(CONFIG.managedProcessesFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeRegistry(items) {
  await fs.writeFile(CONFIG.managedProcessesFile, JSON.stringify(items, null, 2), 'utf8');
}

async function getManagedProcesses() {
  return withLock(CONFIG.managedProcessesFile, async () => {
    return readRegistry();
  });
}

async function registerManagedProcess({
  pid,
  type,
  label = null,
  meta = {},
}) {
  if (!pid || !Number.isInteger(pid)) {
    throw new Error('registerManagedProcess: pid must be an integer');
  }
  if (!type || !String(type).trim()) {
    throw new Error('registerManagedProcess: type is required');
  }

  return withLock(CONFIG.managedProcessesFile, async () => {
    const list = await readRegistry();
    const nextItem = {
      pid,
      type: String(type).trim(),
      label: label ? String(label).trim() : null,
      meta: meta && typeof meta === 'object' ? meta : {},
      createdAt: nowIso(),
    };

    const idx = list.findIndex((x) => x.pid === pid);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...nextItem };
    } else {
      list.push(nextItem);
    }

    await writeRegistry(list);
    return nextItem;
  });
}

async function unregisterManagedProcess(pid) {
  if (!pid) return;

  return withLock(CONFIG.managedProcessesFile, async () => {
    const list = await readRegistry();
    const next = list.filter((x) => x.pid !== pid);
    await writeRegistry(next);
    return { ok: true };
  });
}

async function pruneDeadManagedProcesses() {
  return withLock(CONFIG.managedProcessesFile, async () => {
    const list = await readRegistry();
    const alive = list.filter((x) => isPidRunning(x.pid));
    const removed = list.length - alive.length;

    if (removed > 0) {
      await writeRegistry(alive);
      logger.info('Pruned dead managed processes', { removed });
    }

    return {
      ok: true,
      removed,
      aliveCount: alive.length,
    };
  });
}

async function listManagedProcesses({ types = null } = {}) {
  const list = await getManagedProcesses();
  if (!types || !types.length) return list;
  const typeSet = new Set(types.map(String));
  return list.filter((x) => typeSet.has(String(x.type)));
}

async function killManagedProcesses({
  types = null,
  excludePid = null,
  signal = 'SIGKILL',
} = {}) {
  return withLock(CONFIG.managedProcessesFile, async () => {
    const list = await readRegistry();
    const typeSet = types && types.length ? new Set(types.map(String)) : null;

    const targets = list.filter((x) => {
      if (!x.pid) return false;
      if (excludePid && x.pid === excludePid) return false;
      if (typeSet && !typeSet.has(String(x.type))) return false;
      return true;
    });

    let killedCount = 0;
    const failed = [];

    for (const item of targets) {
      try {
        if (isPidRunning(item.pid)) {
          await killProcessGroup(item.pid, signal);
          killedCount++;
        }
      } catch (err) {
        failed.push({
          pid: item.pid,
          type: item.type,
          error: String(err.message || err),
        });
      }
    }

    const survivors = list.filter((x) => {
      if (excludePid && x.pid === excludePid) return true;
      if (typeSet && !typeSet.has(String(x.type))) return true;
      return isPidRunning(x.pid);
    });

    await writeRegistry(survivors);

    return {
      ok: true,
      killedCount,
      failed,
      remaining: survivors.length,
    };
  });
}

module.exports = {
  getManagedProcesses,
  registerManagedProcess,
  unregisterManagedProcess,
  pruneDeadManagedProcesses,
  listManagedProcesses,
  killManagedProcesses,
};