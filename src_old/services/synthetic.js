const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { CONFIG } = require('../config');
const logger = require('../utils/logger');

function resolveSyntheticDataKitBin() {
  const candidates = [];

  if (CONFIG.syntheticDataKitBin) {
    candidates.push(CONFIG.syntheticDataKitBin);
  }

  candidates.push('synthetic-data-kit');

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (candidate.includes('/') || path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      continue;
    }

    const probe = spawnSync(candidate, ['--help'], {
      stdio: 'ignore',
      env: process.env,
    });

    if (!probe.error) {
      return candidate;
    }
  }

  const configured = CONFIG.syntheticDataKitBin || 'synthetic-data-kit';
  throw new Error(
    `synthetic-data-kit CLI not found. Set SYNTHETIC_DATA_KIT_BIN or install the binary. Tried: ${configured}, synthetic-data-kit`
  );
}

async function runSyntheticCommand(args, { logFile, cwd, env }) {
  const bin = resolveSyntheticDataKitBin();
  const outFd = fs.openSync(logFile, 'a');

  return new Promise((resolve, reject) => {
    logger.info('Running synthetic-data-kit command', {
      bin,
      args,
      cwd,
    });

    const child = spawn(bin, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', outFd, outFd],
    });

    child.on('exit', (code) => {
      fs.closeSync(outFd);

      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`synthetic-data-kit ${args[0]} failed with code ${code}`));
      }
    });

    child.on('error', (err) => {
      fs.closeSync(outFd);

      if (err && err.code === 'ENOENT') {
        reject(
          new Error(
            `synthetic-data-kit CLI not found: ${bin}. Set SYNTHETIC_DATA_KIT_BIN to the full binary path.`
          )
        );
        return;
      }

      reject(err);
    });
  });
}

async function runSyntheticGenJob(job, updateStatus) {
  const { paramsSnapshot: cfg, logFile, outputDir } = job;

  const env = {
    // при необходимости можно пробросить доп. env для CLI
  };

  const jobDir = outputDir;
  await fsp.mkdir(jobDir, { recursive: true });

  const inputDir = path.join(jobDir, 'input');
  const parsedDir = path.join(jobDir, 'parsed');
  const generatedDir = path.join(jobDir, 'generated');
  const curatedDir = path.join(jobDir, 'curated');
  const finalDir = path.join(jobDir, 'final');

  await Promise.all([
    fsp.mkdir(inputDir, { recursive: true }),
    fsp.mkdir(parsedDir, { recursive: true }),
    fsp.mkdir(generatedDir, { recursive: true }),
    fsp.mkdir(curatedDir, { recursive: true }),
    fsp.mkdir(finalDir, { recursive: true }),
  ]);

  for (const src of cfg.sourceFiles) {
    const filename = path.basename(src);
    await fsp.copyFile(src, path.join(inputDir, filename));
  }

  const commonArgs = [
    '--api-base',
    cfg.apiBase || `http://localhost:${CONFIG.vllmPort}/v1`,
    '--model',
    cfg.model,
  ];

  await updateStatus('ingesting');
  await runSyntheticCommand(['ingest', inputDir, '-o', parsedDir], {
    logFile,
    cwd: jobDir,
    env,
  });

  await updateStatus('generating');
  await runSyntheticCommand(
    [
      'create',
      parsedDir,
      '--type',
      cfg.type,
      '-o',
      generatedDir,
      '--num-pairs',
      String(cfg.numPairs),
      '--chunk-size',
      String(cfg.chunkSize),
      '--chunk-overlap',
      String(cfg.chunkOverlap),
      ...commonArgs,
    ],
    { logFile, cwd: jobDir, env },
  );

  let resultDir = generatedDir;

  if (cfg.curate) {
    await updateStatus('curating');
    await runSyntheticCommand(
      [
        'curate',
        generatedDir,
        '-o',
        curatedDir,
        '--threshold',
        String(cfg.curateThreshold),
        ...commonArgs,
      ],
      { logFile, cwd: jobDir, env },
    );
    resultDir = curatedDir;
  }

  await updateStatus('saving');
  await runSyntheticCommand(
    ['save-as', resultDir, '-o', finalDir, '--format', 'jsonl'],
    { logFile, cwd: jobDir, env },
  );

  const files = await fsp.readdir(finalDir);
  const finalFile = files.find((f) => f.endsWith('.jsonl'));

  if (!finalFile) {
    throw new Error('No final jsonl file generated');
  }

  return {
    finalPath: path.join(finalDir, finalFile),
    stats: {},
  };
}

module.exports = {
  runSyntheticGenJob,
};