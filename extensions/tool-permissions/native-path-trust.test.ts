import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION, NATIVE_PATH_TRUST_NONCE } from "./native-contract.ts";
import { evaluatePathTrust } from "./native-path-trust.ts";

test("canonical path and working directory match the current host for an existing read", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");

  const result = evaluatePathTrust({
    version: NATIVE_CONTRACT_VERSION,
    operation: "path_trust",
    nonce: NATIVE_PATH_TRUST_NONCE,
    tool: "read",
    requestedPath: "notes.txt",
    cwd,
    trustPath: null,
    trustDecision: false,
  });

  assert.equal(result.cwd, realpathSync(cwd));
  assert.equal(result.path, realpathSync(join(cwd, "notes.txt")));
});
