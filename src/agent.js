const axios = require('axios');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

require('dotenv').config();

const ORCHESTRATOR_URL = String(
  process.env.ORCHESTRATOR_URL || 'http://localhost:8787'
).replace(/\/+$/, '');

const WORKER_NAME = process.env.WORKER_NAME || 'remote-worker';
const HF_TOKEN = process.env.HF_TOKEN || '';
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || 10000);
const HEARTBEAT_INTERVAL = Number(process.env.HEARTBEAT_INTERVAL || 30000);

const TRAINER_IMAGE = process.env.TRAINER_IMAGE || 'itk-ai-trainer-service:qwen-7b';
const OUTPUT_ROOT = process.env.OUTPUT_ROOT || '/storage/data/llm-lab/.remote-output';
const CACHE_ROOT = process.env.CACHE_ROOT || '/storage/data/llm-lab/.remote-cache';

const DOCKER_BIN = process.env.DOCKER_BIN || 'docker';
const DOCKER_NETWORK = process.env.DOCKER_NETWORK || '';
const NVIDIA_VISIBLE_DEVICES = process.env.NVIDIA_VISIBLE_DEVICES || 'all';

let workerId = null;
let workerToken = null;
let currentJobId = null;
let currentContainerName = null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAxiosErrorMessage(err) {
  if (err?.response?.data) {
    try {
      return JSON.stringify(err.response.data);
    } catch {
      return String(err.message || err);
    }
  }
  return String(err?.message || err);
}

function sanitizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'remote-job';
}

function resolveJobConfigUrl(job, config) {
  const explicit = String(config?.job_config_url || '').trim();
  if (explicit) return explicit;

  const fromJob = String(job?.jobConfigUrl || job?.job_config_url || '').trim();
  if (fromJob) return fromJob;

  if (job?.id && config?.callback_auth_token) {
    return `${ORCHESTRATOR_URL}/jobs/${encodeURIComponent(job.id)}/config?token=${encodeURIComponent(
      config.callback_auth_token
    )}`;
  }

  return '';
}

function buildContainerName(job) {
  return `trainer-${sanitizeName(job?.id || job?.jobId || 'job')}`;
}

function getGpuInfo() {
  try {
    const out = execSync(
      'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim();

    if (!out) return [];

    return out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, memory] = line.split(',').map((x) => x.trim());
        return {
          name,
          memory: Number(memory || 0),
        };
      });
  } catch {
    return [];
  }
}

function getCpuInfo() {
  try {
    const cores = Number(execSync('nproc', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
    return { model: 'generic', cores: Number.isFinite(cores) ? cores : 0 };
  } catch {
    return { model: 'generic', cores: 0 };
  }
}

function getMemoryInfo() {
  try {
    const raw = execSync("awk '/MemTotal/ {print $2}' /proc/meminfo", {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();

    const kb = Number(raw || 0);
    const mb = Math.round(kb / 1024);
    return { total: Number.isFinite(mb) ? mb : 0 };
  } catch {
    return { total: 0 };
  }
}

async function registerWorker() {
  console.log('==> registering worker');

  const resources = {
    gpus: getGpuInfo(),
    cpu: getCpuInfo(),
    memory: getMemoryInfo(),
  };

  const response = await axios.post(`${ORCHESTRATOR_URL}/workers/register`, {
    name: WORKER_NAME,
    resources,
    labels: {
      docker: true,
      agent_version: '1.2.0',
      network_mode: 'public-url',
      same_host_as_orchestrator: true,
    },
  });

  workerId = response.data.id;
  workerToken = response.data.token;

  if (!workerId || !workerToken) {
    throw new Error('workers/register did not return id/token');
  }

  console.log(`==> worker registered: ${workerId}`);
}

async function sendHeartbeat() {
  if (!workerId || !workerToken) return;

  try {
    await axios.post(
      `${ORCHESTRATOR_URL}/workers/heartbeat`,
      {
        status: currentJobId ? 'busy' : 'online',
        resources: {
          gpus: getGpuInfo(),
          cpu: getCpuInfo(),
          memory: getMemoryInfo(),
        },
      },
      {
        headers: {
          'x-worker-id': workerId,
          'x-worker-token': workerToken,
        },
      }
    );
  } catch (err) {
    console.error('==> heartbeat failed:', getAxiosErrorMessage(err));
  }
}

async function postFinalFailure(config, job, message) {
  const finalUrl = String(config?.reporting?.final || '').trim();
  const token = String(config?.callback_auth_token || '').trim();

  if (!finalUrl || !token || !job?.id) {
    return;
  }

  try {
    await axios.post(
      finalUrl,
      {
        job_id: job.id,
        job_name: job.name || job.id,
        event: 'final',
        status: 'failed',
        result: {
          status: 'failed',
          job_id: job.id,
          job_name: job.name || job.id,
          error: message,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );
  } catch (err) {
    console.error('==> failed to send synthetic final failure callback:', getAxiosErrorMessage(err));
  }
}

function buildDockerArgs({ containerName, jobConfigUrl, outputDir, cacheDir }) {
  const args = ['run', '--rm', '--name', containerName];

  args.push('--gpus', NVIDIA_VISIBLE_DEVICES);
  args.push('--shm-size', '16g');

  if (DOCKER_NETWORK) {
    args.push('--network', DOCKER_NETWORK);
  }

  args.push('-e', `JOB_CONFIG_URL=${jobConfigUrl}`);
  args.push('-e', `HF_TOKEN=${HF_TOKEN}`);
  args.push('-e', 'PYTHONUNBUFFERED=1');

  args.push('-v', `${outputDir}:/output`);
  args.push('-v', `${cacheDir}:/cache/huggingface`);

  args.push(TRAINER_IMAGE);

  return args;
}

function attachChildLogs(child, prefix) {
  child.stdout.on('data', (chunk) => {
    process.stdout.write(`${prefix}${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`${prefix}${chunk}`);
  });
}

async function runJob(job, config) {
  if (!job?.id) {
    console.error('==> received invalid job payload');
    return;
  }

  currentJobId = job.id;
  currentContainerName = buildContainerName(job);

  const outputDir = path.join(OUTPUT_ROOT, job.id);
  const cacheDir = path.join(CACHE_ROOT, job.id);
  ensureDir(outputDir);
  ensureDir(cacheDir);

  const jobConfigUrl = resolveJobConfigUrl(job, config);
  if (!jobConfigUrl) {
    const message = `job ${job.id} does not contain job_config_url`;
    console.error(`==> ${message}`);
    await postFinalFailure(config, job, message);
    currentJobId = null;
    currentContainerName = null;
    return;
  }

  console.log(`==> starting job ${job.id}`);
  console.log(`==> container: ${currentContainerName}`);
  console.log(`==> trainer image: ${TRAINER_IMAGE}`);
  console.log(`==> job config url: ${jobConfigUrl}`);
  console.log(`==> output dir: ${outputDir}`);
  console.log(`==> cache dir: ${cacheDir}`);

  const args = buildDockerArgs({
    containerName: currentContainerName,
    jobConfigUrl,
    outputDir,
    cacheDir,
  });

  const child = spawn(DOCKER_BIN, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  attachChildLogs(child, '');

  child.on('error', async (err) => {
    const message = `failed to start trainer container: ${err.message}`;
    console.error(`==> ${message}`);
    await postFinalFailure(config, job, message);
    currentJobId = null;
    currentContainerName = null;
  });

  child.on('close', async (code, signal) => {
    console.log(`==> trainer container exited, code=${code}, signal=${signal || 'none'}`);

    if (code !== 0) {
      await postFinalFailure(
        config,
        job,
        `trainer container exited with code ${code}${signal ? `, signal ${signal}` : ''}`
      );
    }

    currentJobId = null;
    currentContainerName = null;
  });
}

async function pollForJob() {
  if (!workerId || !workerToken) return;
  if (currentJobId) return;

  try {
    const response = await axios.get(`${ORCHESTRATOR_URL}/workers/request-job`, {
      headers: {
        'x-worker-id': workerId,
        'x-worker-token': workerToken,
      },
      validateStatus: (status) => status === 200 || status === 204,
      timeout: 20000,
    });

    if (response.status === 204 || !response.data?.job) {
      return;
    }

    const { job, config } = response.data;
    console.log(`==> received job: ${job.id}`);
    await runJob(job, config || {});
  } catch (err) {
    console.error('==> poll failed:', getAxiosErrorMessage(err));
  }
}

async function removeStaleContainer() {
  if (!currentContainerName) return;

  try {
    spawn(DOCKER_BIN, ['rm', '-f', currentContainerName], {
      stdio: 'ignore',
      detached: true,
    }).unref();
  } catch {}
}

async function main() {
  ensureDir(OUTPUT_ROOT);
  ensureDir(CACHE_ROOT);

  while (true) {
    try {
      await registerWorker();
      break;
    } catch (err) {
      console.error('==> register failed:', getAxiosErrorMessage(err));
      await sleep(5000);
    }
  }

  setInterval(() => {
    sendHeartbeat().catch((err) => {
      console.error('==> heartbeat loop error:', getAxiosErrorMessage(err));
    });
  }, HEARTBEAT_INTERVAL);

  setInterval(() => {
    pollForJob().catch((err) => {
      console.error('==> poll loop error:', getAxiosErrorMessage(err));
    });
  }, POLL_INTERVAL);

  await sendHeartbeat();
  await pollForJob();
}

process.on('SIGINT', async () => {
  console.log('==> SIGINT received, shutting down');
  await removeStaleContainer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('==> SIGTERM received, shutting down');
  await removeStaleContainer();
  process.exit(0);
});

main().catch((err) => {
  console.error('==> agent failed:', err);
  process.exit(1);
});
