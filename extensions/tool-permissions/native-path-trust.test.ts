import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  NATIVE_CONTRACT_VERSION,
  NATIVE_PATH_TRUST_NONCE,
} from "./native-contract.ts";
import { evaluatePathTrust } from "./native-path-trust.ts";
import { resolveScopedPermissionDecision } from "./scope.ts";

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

test("missing write under a symlink parent matches the host canonical path", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-symlink-"));
  const cwd = join(root, "project");
  const outside = join(root, "outside");
  mkdirSync(cwd);
  mkdirSync(outside);
  symlinkSync(
    outside,
    join(cwd, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );

  const result = evaluatePathTrust({
    version: NATIVE_CONTRACT_VERSION,
    operation: "path_trust",
    nonce: NATIVE_PATH_TRUST_NONCE,
    tool: "write",
    requestedPath: "escape/new.txt",
    cwd,
    trustPath: null,
    trustDecision: false,
  });

  assert.equal(result.cwd, realpathSync(cwd));
  assert.equal(result.path, join(realpathSync(outside), "new.txt"));
});

test("a path matched by .aiignore is denied", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-aiignore-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  writeFileSync(join(cwd, ".aiignore"), "secret.txt\n");
  writeFileSync(join(cwd, "secret.txt"), "nope");

  const result = evaluatePathTrust({
    version: NATIVE_CONTRACT_VERSION,
    operation: "path_trust",
    nonce: NATIVE_PATH_TRUST_NONCE,
    tool: "read",
    requestedPath: "secret.txt",
    cwd,
    trustPath: null,
    trustDecision: false,
  });

  assert.equal(result.aiignoreMatch, true);
  assert.equal(result.decision, "deny");
});

test("a nearer project denial inside the trusted root matches the host", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-trust-"));
  const repo = join(root, "project");
  const cwd = join(repo, "child");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(repo, ".pi"), { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, "notes.txt"), "hello");
  writeFileSync(
    join(repo, ".pi", "permissions.toml"),
    "[permissions.read]\nallow = [{ path = '.*' }]\ndeny = []\n",
  );
  writeFileSync(
    join(cwd, ".pi", "permissions.toml"),
    "[permissions.read]\nallow = []\ndeny = [{ path = '.*' }]\n",
  );
  const canonicalPath = realpathSync(join(cwd, "notes.txt"));
  const host = resolveScopedPermissionDecision({
    cwd,
    toolName: "read",
    input: { path: canonicalPath },
    userPermissionsPath: join(root, "missing-user.toml"),
    trustResolver: () => ({ path: repo, decision: true }),
  });

  const result = evaluatePathTrust({
    version: NATIVE_CONTRACT_VERSION,
    operation: "path_trust",
    nonce: NATIVE_PATH_TRUST_NONCE,
    tool: "read",
    requestedPath: "notes.txt",
    cwd,
    trustPath: repo,
    trustDecision: true,
  });

  assert.equal(host.source, "project");
  assert.equal(result.decision, host.decision);
  assert.equal(result.trustEligible, true);
});

test("a project policy outside the trusted root is not honored", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-outside-"));
  const repo = join(root, "project");
  const cwd = join(repo, "child");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(join(repo, ".pi"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "notes.txt"), "hello");
  writeFileSync(
    join(repo, ".pi", "permissions.toml"),
    "[permissions.read]\nallow = []\ndeny = [{ path = '.*' }]\n",
  );
  const canonicalPath = realpathSync(join(cwd, "notes.txt"));
  const host = resolveScopedPermissionDecision({
    cwd,
    toolName: "read",
    input: { path: canonicalPath },
    userPermissionsPath: join(root, "missing-user.toml"),
    trustResolver: () => ({ path: cwd, decision: true }),
  });

  const result = evaluatePathTrust({
    version: NATIVE_CONTRACT_VERSION,
    operation: "path_trust",
    nonce: NATIVE_PATH_TRUST_NONCE,
    tool: "read",
    requestedPath: "notes.txt",
    cwd,
    trustPath: cwd,
    trustDecision: true,
  });

  assert.equal(host.decision, "ask");
  assert.equal(result.decision, host.decision);
  assert.equal(result.trustEligible, true);
});
