#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

set -a
source ./.env
set +a

echo "==> node: $(node -v)"
echo "==> npm: $(npm -v)"
echo "==> workspace: $WORKSPACE"

for exe in \
  "$ML_ENV/bin/python" \
  "$QUANTIZE_ENV/bin/python" \
  "$TRANSFORMERS_ENV/bin/python" \
  "$UI_ENV/bin/python"
do
  if [ -x "$exe" ]; then
    "$exe" --version
  else
    echo "missing: $exe"
    exit 1
  fi
done

"$ML_ENV/bin/python" -c "import torch, transformers; print(torch.__version__, transformers.__version__)"
"$QUANTIZE_ENV/bin/python" -c "import torch; print(torch.__version__)"
"$TRANSFORMERS_ENV/bin/python" -c "import flask, transformers, peft; print('transformers env ok')"

echo "==> check ok"