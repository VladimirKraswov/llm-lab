#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
fi

set -a
source ./.env
set +a

PYTHON_BIN="${PYTHON_BIN:-python3.11}"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "Python 3.11 not found: $PYTHON_BIN"
  exit 1
fi

mkdir -p "$WORKSPACE"
mkdir -p "$WORKSPACE/environments"
mkdir -p "$WORKSPACE/models/base"
mkdir -p "$WORKSPACE/data/raw"
mkdir -p "$WORKSPACE/data/processed"
mkdir -p "$WORKSPACE/training/configs"
mkdir -p "$WORKSPACE/training/outputs"
mkdir -p "$WORKSPACE/logs"
mkdir -p "$WORKSPACE/exports/packages"
mkdir -p "$WORKSPACE/synthetic/input"
mkdir -p "$WORKSPACE/synthetic/parsed"
mkdir -p "$WORKSPACE/synthetic/generated"
mkdir -p "$WORKSPACE/synthetic/curated"
mkdir -p "$WORKSPACE/synthetic/final"

create_env () {
  local env_path="$1"
  local req_file="$2"

  echo "==> creating env: $env_path"
  "$PYTHON_BIN" -m venv "$env_path"
  "$env_path/bin/python" -m pip install --upgrade pip setuptools wheel

  if [ -f "$req_file" ]; then
    "$env_path/bin/pip" install -r "$req_file"
  else
    echo "requirements file not found: $req_file"
    exit 1
  fi
}

create_env "$ML_ENV" "$ROOT_DIR/requirements/ml_env.txt"
create_env "$QUANTIZE_ENV" "$ROOT_DIR/requirements/quant_env.txt"
create_env "$TRANSFORMERS_ENV" "$ROOT_DIR/requirements/transformers_env.txt"

mkdir -p "$(dirname "$UI_ENV")"
create_env "$UI_ENV" "$ROOT_DIR/requirements/ui_venv.txt"

echo "==> installing node dependencies"
npm install

if [ -d "web" ] && [ -f "web/package.json" ]; then
  npm --prefix web install
  npm --prefix web run build
fi

echo "==> bootstrap completed"