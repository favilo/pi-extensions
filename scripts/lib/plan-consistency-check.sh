#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required to run plan consistency checks" >&2
  exit 2
fi

exec uv run --no-project --with PyYAML==6.0.2 \
  python "$script_dir/plan-consistency-check.py" "$@"
