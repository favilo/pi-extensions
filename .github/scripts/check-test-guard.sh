#!/usr/bin/env bash
# Every test file must import the hermeticity guard so fetch() stays
# forbidden under any invocation — npm scripts or bare `node --test`.
set -euo pipefail

missing=0
for file in extensions/*/*.test.ts examples/*/*.test.ts; do
  if ! grep -q 'test-support/forbid-fetch' "$file"; then
    echo "MISSING fetch guard import: $file"
    missing=1
  fi
done

if [ "$missing" -ne 0 ]; then
  echo 'Add `import "../test-support/forbid-fetch.ts";` (adjust depth under examples/).'
  exit 1
fi

echo "PASS: all test files import the fetch guard"
