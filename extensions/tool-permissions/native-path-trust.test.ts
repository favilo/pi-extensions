import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
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
import toolPermissionPolicy, { createToolPermissionBoundary } from "./index.ts";
import { evaluatePathTrust } from "./native-path-trust.ts";
import { setNativePackagePathForTests } from "./native-package.ts";
import { executeToolRequest, type ToolRequest } from "./permission-boundary.ts";
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

test("invalid WASM path output denies and is not recorded as an allow", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-invalid-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");
  const packageDir = mkdtempSync(join(tmpdir(), "pi-path-trust-native-"));
  const packagePath = join(packageDir, "index.cjs");
  writeFileSync(
    packagePath,
    "exports.evaluatePathTrust = () => ({ ok: true, decision: 'allow' });\n",
  );
  const restore = setNativePackagePathForTests(packagePath);
  const audits: string[] = [];
  try {
    const boundary = createToolPermissionBoundary({
      audit: (entry) => audits.push(entry.decision),
      execute: async () => "ran",
    });
    const request: ToolRequest = {
      actor: { kind: "main" },
      toolName: "read",
      input: { path: "notes.txt" },
      cwd,
    };
    const result = await executeToolRequest(request, boundary);
    assert.equal(result.status, "denied");
    assert.equal(audits.includes("allow"), false);
  } finally {
    restore();
    rmSync(packageDir, { recursive: true, force: true });
  }
});

test("a disabled native package keeps the TypeScript path decision", async () => {
  const previous = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = "1";
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-fallback-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");
  try {
    const boundary = createToolPermissionBoundary({
      execute: async () => "ran",
    });
    const request: ToolRequest = {
      actor: { kind: "main" },
      toolName: "read",
      input: { path: "notes.txt" },
      cwd,
    };
    const result = await executeToolRequest(request, boundary);
    assert.equal(result.status, "allowed");
  } finally {
    if (previous === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previous;
  }
});

test("a registered read blocks when WASM denies a path the host would allow", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-handler-"));
  const cwd = join(root, "project");
  const agentDir = mkdtempSync(join(tmpdir(), "pi-path-trust-agent-"));
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");
  const packageDir = mkdtempSync(join(tmpdir(), "pi-path-trust-native-"));
  const packagePath = join(packageDir, "index.cjs");
  writeFileSync(
    packagePath,
    [
      "exports.evaluatePathTrust = (request, realpath) => ({",
      "  version: 1,",
      "  operation: 'path_trust',",
      "  ok: true,",
      "  nonce: request.nonce,",
      "  path: realpath(request.cwd + '/' + request.requestedPath),",
      "  cwd: realpath(request.cwd),",
      "  trustEligible: true,",
      "  aiignoreMatch: false,",
      "  decision: 'deny',",
      "});",
    ].join("\n"),
  );
  const restore = setNativePackagePathForTests(packagePath);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const handlers = new Map<
    string,
    (
      event: {
        toolName: string;
        toolCallId: string;
        input: { path: string };
      },
      ctx: { cwd: string; hasUI: boolean; ui: { notify: () => void } },
    ) => Promise<{ block?: boolean } | undefined>
  >();
  try {
    toolPermissionPolicy({
      registerCommand() {},
      on(
        event: string,
        handler: (
          event: {
            toolName: string;
            toolCallId: string;
            input: { path: string };
          },
          ctx: { cwd: string; hasUI: boolean; ui: { notify: () => void } },
        ) => Promise<{ block?: boolean } | undefined>,
      ) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [],
    } as never);
    const result = await handlers.get("tool_call")?.(
      {
        toolName: "read",
        toolCallId: "wasm-deny-read",
        input: { path: "notes.txt" },
      },
      { cwd, hasUI: false, ui: { notify() {} } },
    );
    assert.equal(result?.block, true);
  } finally {
    restore();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(packageDir, { recursive: true, force: true });
  }
});
