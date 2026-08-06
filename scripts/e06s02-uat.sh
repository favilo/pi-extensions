#!/usr/bin/env bash
set -euo pipefail

# Manual/CLI UAT harness for the permission-enforced subagent runtime.
# Requires a configured Pi model. It never touches the user's normal agent dir.
scenario="${1:-allowed}"
case "$scenario" in
  allowed|denied|unlisted) ;;
  *) echo "usage: $0 {allowed|denied|unlisted}" >&2; exit 2 ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/pi-e06s02-uat.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT
mkdir -p "$tmp_dir/agent"
source_agent_dir="${PI_UAT_SOURCE_AGENT_DIR:-${HOME}/.pi/agent}"
for private_file in auth.json models.json; do
  if [[ -f "$source_agent_dir/$private_file" ]]; then
    cp "$source_agent_dir/$private_file" "$tmp_dir/agent/$private_file"
  fi
done
rm -f "${TMPDIR:-/tmp}/pi-subagent-debug.jsonl"

case "$scenario" in
  allowed)
    cat >"$tmp_dir/agent/permissions.toml" <<'EOF'
[[permissions.subagent.allow]]

[[permissions.bash.allow]]
command = "^ls -l$"
EOF
    ;;
  denied)
    cat >"$tmp_dir/agent/permissions.toml" <<'EOF'
[[permissions.subagent.allow]]

[[permissions.bash.deny]]
command = "^ls -l$"
EOF
    ;;
  unlisted)
    cat >"$tmp_dir/agent/permissions.toml" <<'EOF'
[[permissions.subagent.allow]]
EOF
    ;;
esac

export PI_CODING_AGENT_DIR="$tmp_dir/agent"
export PI_SUBAGENT_DEBUG=1
export PI_UAT_SCENARIO="$scenario"

prompt='Use exactly one subagent named uat-child. Ask it to use subagent-tool-request with toolName "bash" and input {"command":"ls -l"}. Report the returned delegated result verbatim.'

set +e
pi --no-extensions \
  -e "$root/extensions/tool-permissions/index.ts" \
  -e "$root/extensions/subagent/index.ts" \
  --print "$prompt" >"$tmp_dir/output.txt" 2>&1
exit_code=$?
set -e

printf '%s\n' "scenario=$scenario" "pi_exit_code=$exit_code" "--- output ---"
cat "$tmp_dir/output.txt"
printf '%s\n' "--- debug ---"
if [[ -f "${TMPDIR:-/tmp}/pi-subagent-debug.jsonl" ]]; then
  cat "${TMPDIR:-/tmp}/pi-subagent-debug.jsonl"
else
  echo "(no debug log found)"
fi

# The harness is evidence-producing rather than a universal pass/fail assertion:
# provider/model availability and policy outcomes are reported above for review.
exit "$exit_code"
