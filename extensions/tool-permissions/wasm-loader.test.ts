import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WASM_CONTRACT_VERSION } from "./wasm-contract.ts";
import { loadWasmProbe } from "./wasm-loader.ts";

function artifactPath(): { directory: string; path: string } {
  const directory = mkdtempSync(join(tmpdir(), "tool-permissions-wasm-"));
  const path = join(directory, "probe.wasm");
  writeFileSync(path, Buffer.from([0, 97, 115, 109]));
  return { directory, path };
}

test("loads a compatible artifact and completes the version handshake", async () => {
  const artifact = artifactPath();
  try {
    const result = await loadWasmProbe({
      artifactPath: artifact.path,
      nonce: "nonce-1",
      instantiate: async () => ({
        probe: (requestJson) => {
          const request = JSON.parse(requestJson) as { operation: string; payload: { nonce: string } };
          return JSON.stringify({
            version: WASM_CONTRACT_VERSION,
            operation: request.operation,
            ok: true,
            payload: { nonce: request.payload.nonce },
          });
        },
      }),
    });
    assert.deepEqual(result, {
      engine: "wasm",
      response: {
        version: WASM_CONTRACT_VERSION,
        operation: "health",
        ok: true,
        payload: { nonce: "nonce-1" },
      },
    });
  } finally {
    rmSync(artifact.directory, { recursive: true, force: true });
  }
});

test("falls back to TypeScript when the artifact is missing", async () => {
  const result = await loadWasmProbe({ artifactPath: "/missing/probe.wasm" });
  assert.equal(result.engine, "typescript");
  assert.match(result.reason, /missing|unavailable|load/i);
});

test("falls back to TypeScript for incompatible output or module failures", async () => {
  const artifact = artifactPath();
  try {
    for (const instantiate of [
      async () => ({ probe: () => ({ version: WASM_CONTRACT_VERSION + 1 }) }),
      async () => { throw new Error("module panic"); },
    ]) {
      const result = await loadWasmProbe({ artifactPath: artifact.path, instantiate });
      assert.equal(result.engine, "typescript");
      assert.match(result.reason, /contract|version|panic|load/i);
    }
  } finally {
    rmSync(artifact.directory, { recursive: true, force: true });
  }
});
