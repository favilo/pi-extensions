import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { NATIVE_CONTRACT_VERSION, decodeNativeProbeResponse } from "./native-contract.ts";

test("accepts only a compatible native response shape", () => {
  assert.deepEqual(decodeNativeProbeResponse({
    version: NATIVE_CONTRACT_VERSION,
    operation: "health",
    ok: true,
    nonce: "native-1",
  }), {
    version: NATIVE_CONTRACT_VERSION,
    operation: "health",
    ok: true,
    nonce: "native-1",
  });

  assert.throws(() => decodeNativeProbeResponse({
    version: NATIVE_CONTRACT_VERSION + 1,
    operation: "health",
    ok: true,
    nonce: "native-1",
  }), /version/i);

  assert.throws(() => decodeNativeProbeResponse({
    version: NATIVE_CONTRACT_VERSION,
    operation: "health",
    ok: false,
    nonce: "native-1",
  }), /contract|response|ok/i);
});
