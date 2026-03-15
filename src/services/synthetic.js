const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn } = require('child_process');
const { CONFIG } = require('../config');
const logger = require('../utils/logger');
const { uid } = require('../utils/ids');

async function runSyntheticCommand(args, { logFile, cwd, env }) {
  const outFd = fs.openSync(logFile, 'a');

  return new Promise((resolve, reject) => {
    logger.info(`Running synthetic-data-kit ${args.join(' ')}`);
    const child = spawn('synthetic-data-kit', args, {
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
      reject(err);
    });
  });
}

async function runSyntheticGenJob(job, updateStatus) {
  const { id, paramsSnapshot: cfg, logFile, outputDir } = job;
  const env = {
    // Ensure we use the correct LLM provider/model if needed,
    // although synthetic-data-kit CLI prefers config or flags.
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

  // 1. Copy source files to job input dir
  for (const src of cfg.sourceFiles) {
    const filename = path.basename(src);
    await fsp.copyFile(src, path.join(inputDir, filename));
  }

  const commonArgs = [
    '--api-base', cfg.apiBase || `http://localhost:${CONFIG.vllmPort}/v1`,
    '--model', cfg.model,
  ];

  // 2. Ingest
  await updateStatus('ingesting');
  await runSyntheticCommand(['ingest', inputDir, '-o', parsedDir], { logFile, cwd: jobDir, env });

  // 3. Create
  await updateStatus('generating');
  await runSyntheticCommand([
    'create', parsedDir,
    '--type', cfg.type,
    '-o', generatedDir,
    '--num-pairs', String(cfg.numPairs),
    '--chunk-size', String(cfg.chunkSize),
    '--chunk-overlap', String(cfg.chunkOverlap),
    ...commonArgs
  ], { logFile, cwd: jobDir, env });

  let resultDir = generatedDir;

  // 4. Curate (optional)
  if (cfg.curate) {
    await updateStatus('curating');
    await runSyntheticCommand([
      'curate', generatedDir,
      '-o', curatedDir,
      '--threshold', String(cfg.curateThreshold),
      ...commonArgs
    ], { logFile, cwd: jobDir, env });
    resultDir = curatedDir;
  }

  // 5. Save-as
  await updateStatus('saving');
  await runSyntheticCommand([
    'save-as', resultDir,
    '-o', finalDir,
    '--format', 'jsonl'
  ], { logFile, cwd: jobDir, env });

  // 6. Identify the final file
  const files = await fsp.readdir(finalDir);
  const finalFile = files.find(f => f.endsWith('.jsonl'));
  if (!finalFile) {
    throw new Error('No final jsonl file generated');
  }

  return {
    finalPath: path.join(finalDir, finalFile),
    stats: {
      // Could parse the final file to get row count
    }
  };
}

module.exports = {
  runSyntheticGenJob,
};
