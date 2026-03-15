const path = require('path');
const os = require('os');
const fsp = require('fs/promises');
const { spawn } = require('child_process');
const { uid } = require('./ids');
const logger = require('./logger');

function maskSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(maskSecrets);
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      const k = key.toLowerCase();
      if (
        k.includes('apikey') ||
        k.includes('api_key') ||
        k.includes('token') ||
        k.includes('secret') ||
        k.includes('password')
      ) {
        out[key] = v ? '***' : v;
      } else {
        out[key] = maskSecrets(v);
      }
    }
    return out;
  }

  return value;
}

async function createTempJsonConfig(payload, options = {}) {
  const dir = options.dir || path.join(os.tmpdir(), 'llm-lab-json');
  const prefix = options.prefix || 'job';

  await fsp.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${prefix}-${uid('cfg')}.json`);
  await fsp.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

  return filePath;
}

function attachCleanup(child, filePath) {
  const cleanup = async () => {
    try {
      await fsp.unlink(filePath);
    } catch {
      // ignore
    }
  };

  child.once('exit', cleanup);
  child.once('error', cleanup);
}

async function spawnPythonJsonScript({
  pythonBin,
  scriptPath,
  payload,
  cwd,
  env,
  detached = false,
  stdio = 'pipe',
  configDir,
  configPrefix,
  logPayload = true,
  logLabel = null,
}) {
  const configPath = await createTempJsonConfig(payload, {
    dir: configDir,
    prefix: configPrefix,
  });

  if (logPayload) {
    logger.info('Prepared Python JSON config', {
      label: logLabel || path.basename(scriptPath),
      scriptPath,
      configPath,
      payload: maskSecrets(payload),
    });
  } else {
    logger.info('Prepared Python JSON config', {
      label: logLabel || path.basename(scriptPath),
      scriptPath,
      configPath,
    });
  }

  const child = spawn(pythonBin, ['-u', scriptPath, configPath], {
    cwd,
    env,
    detached,
    stdio,
  });

  logger.info('Starting Python script', {
    label: logLabel || path.basename(scriptPath),
    scriptPath,
    configPath,
    detached,
  });

  attachCleanup(child, configPath);

  return {
    child,
    configPath,
  };
}

module.exports = {
  createTempJsonConfig,
  spawnPythonJsonScript,
};