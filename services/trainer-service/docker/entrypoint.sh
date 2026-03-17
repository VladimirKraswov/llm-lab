#!/usr/bin/env bash
set -euo pipefail

# Default fallback
DEFAULT_LOCAL_CONFIG="/workspace/configs/trainer/job.json"

CONFIG_SOURCE="${CONFIG_SOURCE:-local}"
CONFIG_REF="${CONFIG_REF:-$DEFAULT_LOCAL_CONFIG}"

# If CONFIG_PATH is explicitly set, use it as local path (backwards compatibility)
if [ -n "${CONFIG_PATH:-}" ]; then
  CONFIG_REF="$CONFIG_PATH"
  CONFIG_SOURCE="local"
fi

echo "==> trainer-service starting"
echo "==> config source: ${CONFIG_SOURCE}"
echo "==> config ref: ${CONFIG_REF}"

if [ "${CONFIG_SOURCE}" = "local" ]; then
  if [ ! -f "${CONFIG_REF}" ]; then
    echo "ERROR: local config file not found: ${CONFIG_REF}"
    exit 1
  fi
fi

# runner.py now handles both local paths and remote URLs via --config
python3 /app/app/runner.py --config "${CONFIG_REF}"
