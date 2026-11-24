import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runBuild(firstFailure: string) {
  const directory = mkdtempSync(join(tmpdir(), "native-build-test-"));
  try {
    const calls = join(directory, "calls");
    const executable = (name: string, body: string) =>
      writeFileSync(join(directory, name), `#!/bin/sh\n${body}\n`, {
        mode: 0o755,
      });
    executable(
      "napi",
      'echo napi >> "$CALLS"\nif [ ! -f "$CALLS.first" ]; then touch "$CALLS.first"; echo "$FAILURE" >&2; exit 1; fi',
    );
    executable("cargo", 'echo "cargo $*" >> "$CALLS"');
    executable("node", 'echo node >> "$CALLS"');
    const result = spawnSync("bash", [resolve("scripts/build-native.sh")], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH}`,
        CALLS: calls,
        FAILURE: firstFailure,
      },
    });
    return { status: result.status, calls: readFileSync(calls, "utf8") };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("retries the known missing runtime metadata error once", () => {
  const result = runBuild(
    "does not export the napi-async-runtime host contract",
  );
  assert.equal(result.status, 0);
  assert.match(
    result.calls,
    /cargo clean .* -p napi-async-runtime --release --target wasm32-wasip1-threads/,
  );
  assert.equal(result.calls.match(/^napi$/gm)?.length, 2);
});

test("does not retry unrelated build failures", () => {
  const result = runBuild("unrelated compiler failure");
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.calls, /cargo/);
  assert.equal(result.calls.match(/^napi$/gm)?.length, 1);
});
