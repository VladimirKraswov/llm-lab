#!/usr/bin/env bash
set -euo pipefail

CONFIG_PATH="${CONFIG_PATH:-/workspace/configs/trainer/job.json}"

echo "==> trainer-service starting"
echo "==> config: ${CONFIG_PATH}"

if [ ! -f "${CONFIG_PATH}" ]; then
  echo "ERROR: config file not found: ${CONFIG_PATH}"
  exit 1
fi

python3 /app/app/runner.py --config "${CONFIG_PATH}"