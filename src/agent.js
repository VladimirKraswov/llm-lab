const axios = require('axios');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8787';
const WORKER_NAME = process.env.WORKER_NAME || 'remote-worker';
const HF_TOKEN = process.env.HF_TOKEN;
const POLL_INTERVAL = 10000;

let workerId = null;
let workerToken = null;
let currentJobId = null;

async function register() {
  console.log('Registering worker...');
  const resources = {
    gpus: getGpuInfo(),
    cpu: getCpuInfo(),
    memory: getMemoryInfo(),
  };

  const res = await axios.post(`${ORCHESTRATOR_URL}/workers/register`, {
    name: WORKER_NAME,
    resources,
    labels: {
      docker: true,
      agent_version: '1.0.0',
    },
  });

  workerId = res.data.id;
  workerToken = res.data.token;
  console.log(`Registered as ${workerId}`);
}

async function heartbeat() {
  if (!workerId) return;
  try {
    await axios.post(`${ORCHESTRATOR_URL}/workers/heartbeat`, {
      status: currentJobId ? 'busy' : 'online',
    }, {
      headers: { 'x-worker-id': workerId, 'x-worker-token': workerToken }
    });
  } catch (err) {
    console.error('Heartbeat failed', err.message);
  }
}

async function pollForJob() {
  if (currentJobId) return;

  try {
    const res = await axios.get(`${ORCHESTRATOR_URL}/workers/request-job`, {
      headers: { 'x-worker-id': workerId, 'x-worker-token': workerToken }
    });

    if (res.status === 200 && res.data.job) {
      console.log(`Received job: ${res.data.job.id}`);
      runJob(res.data.job, res.data.config);
    }
  } catch (err) {
    console.error('Poll failed', err.message);
  }
}

function runJob(job, config) {
  currentJobId = job.id;

  const containerName = `trainer-${job.id}`;
  const image = process.env.TRAINER_IMAGE || 'llm-lab-trainer:latest';

  console.log(`Starting container ${containerName} with image ${image}`);

  const args = [
    'run', '--rm', '--name', containerName,
    '--runtime=nvidia', '--gpus', 'all',
    '-e', `JOB_CONFIG_URL=${ORCHESTRATOR_URL}/api/jobs/${job.id}/config?token=${config.callback_auth_token}`,
    '-e', `HF_TOKEN=${HF_TOKEN}`,
    image
  ];

  const child = spawn('docker', args);

  child.stdout.on('data', (data) => {
    // We could stream logs here too, but the trainer container is expected
    // to send its own logs via callback. This is just for agent visibility.
    process.stdout.write(data);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(data);
  });

  child.on('close', (code) => {
    console.log(`Trainer container exited with code ${code}`);
    currentJobId = null;
  });
}

// Helpers
function getGpuInfo() {
  try {
    const out = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits').toString();
    return out.trim().split('\n').map(line => {
      const [name, memory] = line.split(', ');
      return { name, memory: parseInt(memory) };
    });
  } catch {
    return [];
  }
}

function getCpuInfo() {
  return { model: 'generic', cores: 8 };
}

function getMemoryInfo() {
  return { total: 32768 };
}

async function main() {
  await register();
  setInterval(heartbeat, 30000);
  setInterval(pollForJob, POLL_INTERVAL);
}

main().catch(err => {
  console.error('Agent failed', err);
  process.exit(1);
});
