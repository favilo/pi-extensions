import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import { loadNativePackageProbe, loadNativeProbe } from "./native-loader.ts";

test("loads a compatible native module and validates its handshake", async () => {
  const result = await loadNativeProbe({
    nonce: "native-1",
    load: async () => ({
      probe: (request) => ({
        version: NATIVE_CONTRACT_VERSION,
        operation: request.operation,
        ok: true,
        nonce: request.nonce,
      }),
    }),
  });
  assert.deepEqual(result, {
    engine: "native",
    response: {
      version: NATIVE_CONTRACT_VERSION,
      operation: "health",
      ok: true,
      nonce: "native-1",
    },
  });
});

test("loads a generated native package by path through the host seam", async () => {
  const directory = mkdtempSync(join(tmpdir(), "tool-permissions-native-"));
  const packagePath = join(directory, "index.cjs");
  writeFileSync(packagePath, `module.exports = { probe(request) { return { version: 1, operation: request.operation, ok: true, nonce: request.nonce }; } };`);
  try {
    const result = await loadNativePackageProbe(packagePath, "package-1");
    assert.equal(result.engine, "native");
    assert.equal(result.response.nonce, "package-1");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("falls back when the native package cannot load or returns invalid output", async () => {
  for (const load of [
    async () => { throw new Error("package missing"); },
    async () => ({ probe: () => ({ version: NATIVE_CONTRACT_VERSION + 1 }) }),
  ]) {
    const result = await loadNativeProbe({ load });
    assert.equal(result.engine, "typescript");
    assert.match(result.reason, /native|package|version|contract/i);
  }
});
