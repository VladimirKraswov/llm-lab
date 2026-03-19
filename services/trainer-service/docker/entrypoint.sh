#!/usr/bin/env bash
set -euo pipefail

DEFAULT_LOCAL_CONFIG="/workspace/configs/trainer/job.json"

echo "==> trainer-service starting"

# Явный запуск через аргументы:
# docker run ... trainer-service --config https://...
if [ "$#" -gt 0 ]; then
  echo "==> launching with explicit CLI args: $*"
  exec python /trainer/app/runner.py "$@"
fi

CONFIG_SOURCE="${CONFIG_SOURCE:-local}"
CONFIG_REF="${CONFIG_REF:-$DEFAULT_LOCAL_CONFIG}"

# backward compatibility
if [ -n "${CONFIG_PATH:-}" ]; then
  CONFIG_REF="$CONFIG_PATH"
  CONFIG_SOURCE="local"
fi

echo "==> config source: ${CONFIG_SOURCE}"
echo "==> config ref: ${CONFIG_REF}"
echo "==> model path in image assumed at: /app"

if [ "${CONFIG_SOURCE}" = "local" ]; then
  if [ ! -f "${CONFIG_REF}" ]; then
    echo "ERROR: local config file not found: ${CONFIG_REF}"
    exit 1
  fi
fi

# Не делаем mv/cp модели — используем её прямо из /app
exec python /trainer/app/runner.py --config "${CONFIG_REF}"