import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import { loadNativeProbe } from "./native-loader.ts";

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
