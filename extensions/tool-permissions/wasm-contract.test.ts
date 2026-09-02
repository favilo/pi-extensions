import test from "node:test";
import assert from "node:assert/strict";
import {
  WASM_CONTRACT_VERSION,
  createProbeRequest,
  decodeProbeResponse,
} from "./wasm-contract.ts";

test("creates a versioned structured probe request", () => {
  assert.deepEqual(createProbeRequest("nonce-1"), {
    version: WASM_CONTRACT_VERSION,
    operation: "health",
    payload: { nonce: "nonce-1" },
  });
});

test("accepts only a compatible structured probe response", () => {
  assert.deepEqual(decodeProbeResponse({
    version: WASM_CONTRACT_VERSION,
    operation: "health",
    ok: true,
    payload: { nonce: "nonce-1" },
  }), {
    version: WASM_CONTRACT_VERSION,
    operation: "health",
    ok: true,
    payload: { nonce: "nonce-1" },
  });

  assert.throws(() => decodeProbeResponse({
    version: WASM_CONTRACT_VERSION + 1,
    operation: "health",
    ok: true,
    payload: { nonce: "nonce-1" },
  }), /version/i);

  assert.throws(() => decodeProbeResponse({
    version: WASM_CONTRACT_VERSION,
    operation: "health",
    ok: "yes",
    payload: { nonce: "nonce-1" },
  }), /response|ok|contract/i);
});
