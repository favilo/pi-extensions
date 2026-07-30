#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="$repo_root/scripts/lib/plan-consistency-check.sh"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv is required to run active plan checks" >&2
  exit 2
fi

found_capsule=false
for capsule in "$repo_root"/.specs/epics/e[0-9]*-*; do
  [[ -d "$capsule" ]] || continue
  found_capsule=true
  bash "$checker" "$capsule"
done

if [[ "$found_capsule" == false ]]; then
  echo "No active epic capsules found under .specs/epics" >&2
  exit 1
fi
