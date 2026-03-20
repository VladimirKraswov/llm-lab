const { getJobById } = require('./jobs');
const { getRuntimePresetById } = require('./runtime-presets');

/**
 * Generates a docker-compose.yaml file for a remote job
 */
function generateDockerCompose(job, preset = null) {
  const image = job.containerImage || (preset ? preset.trainerImage : 'igortet/itk-ai-trainer-service:qwen-7b');
  const shmSize = preset ? preset.defaultShmSize : '16g';

  return `version: '3.8'

services:
  trainer:
    image: ${image}
    container_name: trainer-${job.id}
    restart: "no"
    shm_size: ${shmSize}
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    env_file:
      - .env
    volumes:
      - ./output:/output
      - ./cache/huggingface:/cache/huggingface
    environment:
      - JOB_CONFIG_URL=\${JOB_CONFIG_URL}
      - HF_TOKEN=\${HF_TOKEN}
`;
}

/**
 * Generates a .env file template for a remote job
 */
function generateEnvFile(job, launchUrl) {
  return `# Remote Training Job Environment Configuration
# Job ID: ${job.id}
# Job Name: ${job.name}

# The URL to download the training configuration
JOB_CONFIG_URL=${launchUrl}

# Hugging Face token for publishing (required if hfPublish is enabled)
HF_TOKEN=
`;
}

/**
 * Generates a README.txt file for a remote job bundle
 */
function generateReadme(job) {
  return `Remote Training Launch Bundle
============================

Job ID: ${job.id}
Job Name: ${job.name}
Created: ${new Date().toISOString()}

Quick Start:
-----------
1. Ensure you have Docker and NVIDIA Container Toolkit installed.
2. Edit '.env' file and add your HF_TOKEN if needed.
3. Run the trainer:
   docker compose up -d

Notes:
-----
- The trainer will automatically download the configuration from the orchestrator.
- Output artifacts will be saved in the './output' directory.
- Hugging Face cache will be stored in './cache/huggingface'.
- The container will stop automatically after training is complete.

Log Monitoring:
--------------
To see the logs, run:
docker compose logs -f
`;
}

module.exports = {
  generateDockerCompose,
  generateEnvFile,
  generateReadme,
};
