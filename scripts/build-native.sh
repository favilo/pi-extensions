#!/usr/bin/env bash
set -euo pipefail

log_file=$(mktemp)
trap 'rm -f "$log_file"' EXIT

build() {
  WASI_SDK_PATH="${WASI_SDK_PATH:-$HOME/.local/wasi-sdk}" \
    napi build --cwd extensions/tool-permissions/native --package tool-permissions-native \
    --release --platform --target wasm32-wasip1-threads --output-dir generated
}

if build 2>&1 | tee "$log_file"; then
  :
elif grep -Fq 'does not export the napi-async-runtime host contract' "$log_file"; then
  echo 'Refreshing stale napi-async-runtime release metadata and retrying once.' >&2
  cargo clean --manifest-path extensions/tool-permissions/native/Cargo.toml \
    -p napi-async-runtime --release --target wasm32-wasip1-threads
  build
else
  exit 1
fi

node scripts/patch-wasi-init-tp.mjs
rm -f extensions/tool-permissions/native/generated/*.node
