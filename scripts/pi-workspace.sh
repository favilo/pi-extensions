#!/usr/bin/env bash
# Start Pi with this directory in place of the configured pi-extensions package.
# Every other package from the user settings stays loaded.
set -euo pipefail

workspace=$(pwd -P)
agent_dir=${PI_CODING_AGENT_DIR:-"$HOME/.pi/agent"}
agent_dir=$(cd "$agent_dir" && pwd -P)

if [[ ! -f "$agent_dir/settings.json" ]]; then
  printf 'pi agent settings not found: %s\n' "$agent_dir/settings.json" >&2
  exit 1
fi

if [[ ! -f "$workspace/package.json" ]]; then
  printf 'current directory has no package.json: %s\n' "$workspace" >&2
  exit 1
fi

workspace_name=$(jq -r '.name // empty' "$workspace/package.json")
if [[ "$workspace_name" != "pi-extensions" ]]; then
  printf 'expected package name pi-extensions in %s, found %s\n' \
    "$workspace" "${workspace_name:-<none>}" >&2
  exit 1
fi

# Per-run overlay: rewrite only settings.json, and symlink all normal agent
# state so Pi behaves exactly as it does outside this workspace.
overlay=$(mktemp -d "${TMPDIR:-/tmp}/agent-pi-extensions.XXXXXX")
cleanup() {
  rm -rf "$overlay"
}
trap cleanup EXIT

shopt -s nullglob dotglob
for entry in "$agent_dir"/*; do
  base=$(basename "$entry")
  if [[ "$base" == "settings.json" ]]; then
    continue
  fi
  ln -s "$entry" "$overlay/$base"
done
shopt -u nullglob dotglob

# settings.json is the only overlay-local file.
# It is written after the package list is updated below.
if [[ -e "$overlay/settings.json" || -L "$overlay/settings.json" ]]; then
  rm -f "$overlay/settings.json"
fi

resolve_local() {
  local src="$1"
  local tilde_prefix='~'
  if [[ "$src" == "$tilde_prefix" ]]; then
    src=$HOME
  elif [[ "$src" == "$tilde_prefix/"* ]]; then
    src="$HOME/${src:2}"
  elif [[ "$src" != /* ]]; then
    src="$agent_dir/$src"
  fi
  if [[ -d "$src" ]]; then
    (cd "$src" && pwd -P)
  else
    node -e 'process.stdout.write(require("path").resolve(process.argv[1]))' "$src"
  fi
}

is_pi_extensions_dir() {
  local dir="$1"
  [[ -f "$dir/package.json" ]] || return 1
  [[ $(jq -r '.name // empty' "$dir/package.json") == "pi-extensions" ]]
}

packages_json=$(jq -c '.packages // []' "$agent_dir/settings.json")
package_count=$(jq 'length' <<<"$packages_json")
new_packages='[]'
replaced=0

for ((i = 0; i < package_count; i++)); do
  entry=$(jq -c ".[$i]" <<<"$packages_json")
  if jq -e 'type == "string"' <<<"$entry" >/dev/null; then
    raw=$(jq -r '.' <<<"$entry")
    kind=string
  elif jq -e 'type == "object" and (.source | type == "string")' <<<"$entry" >/dev/null; then
    raw=$(jq -r '.source' <<<"$entry")
    kind=object
  else
    new_packages=$(jq -c --argjson entry "$entry" '. + [$entry]' <<<"$new_packages")
    continue
  fi

  case "$raw" in
    npm:* | git:* | git@* | http:* | https:* | ssh:*)
      new_packages=$(jq -c --argjson entry "$entry" '. + [$entry]' <<<"$new_packages")
      continue
      ;;
  esac

  resolved=$(resolve_local "$raw")
  if is_pi_extensions_dir "$resolved"; then
    if [[ "$replaced" -eq 1 ]]; then
      continue
    fi
    if [[ "$kind" == "string" ]]; then
      entry=$(jq -nc --arg source "$workspace" '$source')
    else
      entry=$(jq -c --arg source "$workspace" '.source = $source' <<<"$entry")
    fi
    replaced=1
  fi
  new_packages=$(jq -c --argjson entry "$entry" '. + [$entry]' <<<"$new_packages")
done

if [[ "$replaced" -eq 0 ]]; then
  new_packages=$(jq -c --arg source "$workspace" '. + [$source]' <<<"$new_packages")
fi

tmp_settings=$(mktemp "$overlay/settings.json.XXXXXX")
jq --argjson packages "$new_packages" '.packages = $packages' "$agent_dir/settings.json" >"$tmp_settings"
mv "$tmp_settings" "$overlay/settings.json"

if [[ "${PI_EXTENSIONS_PREPARE_ONLY:-}" == 1 ]]; then
  printf '%s\n' "$overlay"
  exit 0
fi

export PI_CODING_AGENT_DIR="$overlay"
exec pi "$@"
