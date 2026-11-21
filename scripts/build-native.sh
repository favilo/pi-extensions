#!/usr/bin/env bash
set -euo pipefail

WASI_SDK_PATH="${WASI_SDK_PATH:-$HOME/.local/wasi-sdk}" \
  napi build --cwd extensions/tool-permissions/native --package tool-permissions-native \
  --release --platform --target wasm32-wasip1-threads --output-dir generated
node scripts/patch-wasi-init-tp.mjs
rm -f extensions/tool-permissions/native/generated/*.node
