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
import { NATIVE_REGISTRATION_STUB } from "./native-host-test-support.ts";
import { executeToolRequest, type ToolRequest } from "./permission-boundary.ts";
import { resolveScopedPermissionDecision } from "./scope.ts";

function writePathTrustNativePackage(
  packagePath: string,
  evaluateLines: string[],
): void {
  writeFileSync(
    packagePath,
    [NATIVE_REGISTRATION_STUB, ...evaluateLines].join("\n"),
  );
}

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
  assert.equal(result.decision, "allow");
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

test("a directory-only .aiignore pattern matches a directory and not a file", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-dir-"));
  const cwd = join(root, "project");
  mkdirSync(join(cwd, "logs"), { recursive: true });
  writeFileSync(join(cwd, "notes.txt"), "hello");
  writeFileSync(join(cwd, ".aiignore"), "logs/\nnotes.txt/\n");

  const directory = evaluatePathTrust({
    version: NATIVE_CONTRACT_VERSION,
    operation: "path_trust",
    nonce: NATIVE_PATH_TRUST_NONCE,
    tool: "read",
    requestedPath: "logs",
    cwd,
    trustPath: null,
    trustDecision: false,
  });
  const file = evaluatePathTrust({
    version: NATIVE_CONTRACT_VERSION,
    operation: "path_trust",
    nonce: NATIVE_PATH_TRUST_NONCE,
    tool: "read",
    requestedPath: "notes.txt",
    cwd,
    trustPath: null,
    trustDecision: false,
  });

  assert.equal(directory.aiignoreMatch, true);
  assert.equal(directory.decision, "deny");
  assert.equal(file.aiignoreMatch, false);
  assert.equal(file.decision, "allow");
});

test("an invalid .aiignore line asks and names the file", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-bad-ignore-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");
  writeFileSync(join(cwd, ".aiignore"), "[z-a]\n");

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

  assert.equal(result.decision, "ask");
  assert.equal(result.aiignoreMatch, false);
  assert.match(result.diagnostic ?? "", /\.aiignore/);
  assert.match(result.diagnostic ?? "", /invalid/);
});

test("a malformed project policy asks with a diagnostic", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-bad-policy-"));
  const cwd = join(root, "project");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, "notes.txt"), "hello");
  writeFileSync(join(cwd, ".pi", "permissions.toml"), "[[[\n");

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

  assert.equal(result.decision, "ask");
  assert.equal(result.projectMatched, false);
  assert.match(result.diagnostic ?? "", /could not be read/);
});

test("a write inside the working directory stays ask", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-write-inside-"));
  const cwd = join(root, "project");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");

  const result = evaluatePathTrust({
    version: NATIVE_CONTRACT_VERSION,
    operation: "path_trust",
    nonce: NATIVE_PATH_TRUST_NONCE,
    tool: "write",
    requestedPath: "notes.txt",
    cwd,
    trustPath: null,
    trustDecision: false,
  });

  assert.equal(result.decision, "ask");
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
  assert.equal(result.projectMatched, false);
  assert.equal(result.decision, "allow");
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
  writePathTrustNativePackage(packagePath, [
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
  ]);
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
      registerEntryRenderer() {},
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

test("a registered write uses a WASM deny instead of the no-UI ask", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-write-"));
  const cwd = join(root, "project");
  const agentDir = mkdtempSync(join(tmpdir(), "pi-path-trust-write-agent-"));
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");
  const packageDir = mkdtempSync(join(tmpdir(), "pi-path-trust-write-native-"));
  const packagePath = join(packageDir, "index.cjs");
  writePathTrustNativePackage(packagePath, [
    "exports.evaluatePathTrust = (request, realpath) => ({",
    "  version: 1,",
    "  operation: 'path_trust',",
    "  ok: true,",
    "  nonce: request.nonce,",
    "  path: realpath(request.cwd + '/' + request.requestedPath),",
    "  cwd: realpath(request.cwd),",
    "  trustEligible: false,",
    "  aiignoreMatch: false,",
    "  decision: 'deny',",
    "});",
  ]);
  const restore = setNativePackagePathForTests(packagePath);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const handlers = new Map<
    string,
    (
      event: {
        toolName: string;
        toolCallId: string;
        input: { path: string; content: string };
      },
      ctx: { cwd: string; hasUI: boolean; ui: { notify: () => void } },
    ) => Promise<{ block?: boolean; reason?: string } | undefined>
  >();
  try {
    toolPermissionPolicy({
      registerCommand() {},
      registerEntryRenderer() {},
      on(
        event: string,
        handler: (
          event: {
            toolName: string;
            toolCallId: string;
            input: { path: string; content: string };
          },
          ctx: { cwd: string; hasUI: boolean; ui: { notify: () => void } },
        ) => Promise<{ block?: boolean; reason?: string } | undefined>,
      ) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [],
    } as never);
    const result = await handlers.get("tool_call")?.(
      {
        toolName: "write",
        toolCallId: "wasm-deny-write",
        input: { path: "notes.txt", content: "changed" },
      },
      { cwd, hasUI: false, ui: { notify() {} } },
    );
    assert.equal(result?.block, true);
    assert.match(result?.reason ?? "", /configured deny rule/);
  } finally {
    restore();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(packageDir, { recursive: true, force: true });
  }
});

test("a registered write blocks when WASM denies the path for .aiignore", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-write-aiignore-"));
  const cwd = join(root, "project");
  const agentDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-write-aiignore-agent-"),
  );
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");
  const packageDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-write-aiignore-native-"),
  );
  const packagePath = join(packageDir, "index.cjs");
  writePathTrustNativePackage(packagePath, [
    "exports.evaluatePathTrust = (request, realpath) => ({",
    "  version: 1,",
    "  operation: 'path_trust',",
    "  ok: true,",
    "  nonce: request.nonce,",
    "  path: realpath(request.cwd + '/' + request.requestedPath),",
    "  cwd: realpath(request.cwd),",
    "  trustEligible: false,",
    "  aiignoreMatch: true,",
    "  decision: 'deny',",
    "});",
  ]);
  const restore = setNativePackagePathForTests(packagePath);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const handlers = new Map<
    string,
    (
      event: {
        toolName: string;
        toolCallId: string;
        input: { path: string; content: string };
      },
      ctx: { cwd: string; hasUI: boolean; ui: { notify: () => void } },
    ) => Promise<{ block?: boolean; reason?: string } | undefined>
  >();
  try {
    toolPermissionPolicy({
      registerCommand() {},
      registerEntryRenderer() {},
      on(
        event: string,
        handler: (
          event: {
            toolName: string;
            toolCallId: string;
            input: { path: string; content: string };
          },
          ctx: { cwd: string; hasUI: boolean; ui: { notify: () => void } },
        ) => Promise<{ block?: boolean; reason?: string } | undefined>,
      ) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [],
    } as never);
    const result = await handlers.get("tool_call")?.(
      {
        toolName: "write",
        toolCallId: "wasm-aiignore-write",
        input: { path: "notes.txt", content: "changed" },
      },
      { cwd, hasUI: false, ui: { notify() {} } },
    );
    assert.equal(result?.block, true);
    assert.match(result?.reason ?? "", /\.aiignore/);
  } finally {
    restore();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(packageDir, { recursive: true, force: true });
  }
});

test("a registered read blocks without a UI when WASM asks about a broken .aiignore", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-bad-ignore-handler-"));
  const cwd = join(root, "project");
  const agentDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-bad-ignore-agent-"),
  );
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");
  const packageDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-bad-ignore-native-"),
  );
  const packagePath = join(packageDir, "index.cjs");
  const diagnostic = `${cwd}/.aiignore line 1 is invalid`;
  writePathTrustNativePackage(packagePath, [
    "exports.evaluatePathTrust = (request, realpath) => ({",
    "  version: 1,",
    "  operation: 'path_trust',",
    "  ok: true,",
    "  nonce: request.nonce,",
    "  path: realpath(request.cwd + '/' + request.requestedPath),",
    "  cwd: realpath(request.cwd),",
    "  trustEligible: false,",
    "  aiignoreMatch: false,",
    "  decision: 'ask',",
    `  diagnostic: ${JSON.stringify(diagnostic)},`,
    "});",
  ]);
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
    ) => Promise<{ block?: boolean; reason?: string } | undefined>
  >();
  try {
    toolPermissionPolicy({
      registerCommand() {},
      registerEntryRenderer() {},
      on(
        event: string,
        handler: (
          event: {
            toolName: string;
            toolCallId: string;
            input: { path: string };
          },
          ctx: { cwd: string; hasUI: boolean; ui: { notify: () => void } },
        ) => Promise<{ block?: boolean; reason?: string } | undefined>,
      ) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [],
    } as never);
    const result = await handlers.get("tool_call")?.(
      {
        toolName: "read",
        toolCallId: "wasm-bad-aiignore",
        input: { path: "notes.txt" },
      },
      { cwd, hasUI: false, ui: { notify() {} } },
    );
    assert.equal(result?.block, true);
    assert.match(result?.reason ?? "", /invalid/);
  } finally {
    restore();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(packageDir, { recursive: true, force: true });
  }
});

test("a UI prompt shows a broken .aiignore diagnostic and can allow the call once", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-bad-ignore-ui-"));
  const cwd = join(root, "project");
  const agentDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-bad-ignore-ui-agent-"),
  );
  mkdirSync(cwd);
  writeFileSync(join(cwd, "notes.txt"), "hello");
  const packageDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-bad-ignore-ui-native-"),
  );
  const packagePath = join(packageDir, "index.cjs");
  const diagnostic = `${cwd}/.aiignore line 1 is invalid`;
  writePathTrustNativePackage(packagePath, [
    "exports.evaluatePathTrust = (request, realpath) => ({",
    "  version: 1,",
    "  operation: 'path_trust',",
    "  ok: true,",
    "  nonce: request.nonce,",
    "  path: realpath(request.cwd + '/' + request.requestedPath),",
    "  cwd: realpath(request.cwd),",
    "  trustEligible: false,",
    "  aiignoreMatch: false,",
    "  decision: 'ask',",
    `  diagnostic: ${JSON.stringify(diagnostic)},`,
    "});",
  ]);
  const restore = setNativePackagePathForTests(packagePath);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const prompts: Array<{ title: string; body: string }> = [];
  const handlers = new Map<
    string,
    (
      event: {
        toolName: string;
        toolCallId: string;
        input: { path: string };
      },
      ctx: {
        cwd: string;
        hasUI: boolean;
        mode: string;
        sessionId: string;
        ui: {
          notify: () => void;
          confirm: (title: string, body: string) => Promise<boolean>;
        };
      },
    ) => Promise<{ block?: boolean } | undefined>
  >();
  try {
    toolPermissionPolicy({
      registerCommand() {},
      registerEntryRenderer() {},
      on(
        event: string,
        handler: (
          event: {
            toolName: string;
            toolCallId: string;
            input: { path: string };
          },
          ctx: {
            cwd: string;
            hasUI: boolean;
            mode: string;
            ui: {
              notify: () => void;
              confirm: (title: string, body: string) => Promise<boolean>;
            };
          },
        ) => Promise<{ block?: boolean } | undefined>,
      ) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [],
    } as never);
    const result = await handlers.get("tool_call")?.(
      {
        toolName: "read",
        toolCallId: "wasm-bad-aiignore-ui",
        input: { path: "notes.txt" },
      },
      {
        cwd,
        hasUI: true,
        mode: "json",
        sessionId: "path-trust-diagnostic",
        ui: {
          notify() {},
          confirm(title: string, body: string) {
            prompts.push({ title, body });
            return Promise.resolve(true);
          },
        },
      },
    );
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0]?.title, "Permission file needs attention");
    assert.match(prompts[0]?.body ?? "", /invalid/);
    assert.match(prompts[0]?.body ?? "", /Allow this call once/);
    assert.equal(result, undefined);
  } finally {
    restore();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(packageDir, { recursive: true, force: true });
  }
});

test("a registered read keeps a WASM allow when TypeScript .aiignore would deny", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-read-aiignore-"));
  const cwd = join(root, "project");
  const agentDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-read-aiignore-agent-"),
  );
  mkdirSync(cwd);
  writeFileSync(join(cwd, ".aiignore"), "secret.txt\n");
  writeFileSync(join(cwd, "secret.txt"), "nope");
  const packageDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-read-aiignore-native-"),
  );
  const packagePath = join(packageDir, "index.cjs");
  writePathTrustNativePackage(packagePath, [
    "exports.evaluatePathTrust = (request, realpath) => ({",
    "  version: 1,",
    "  operation: 'path_trust',",
    "  ok: true,",
    "  nonce: request.nonce,",
    "  path: realpath(request.cwd + '/' + request.requestedPath),",
    "  cwd: realpath(request.cwd),",
    "  trustEligible: false,",
    "  aiignoreMatch: false,",
    "  decision: 'allow',",
    "});",
  ]);
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
    ) => Promise<{ block?: boolean; reason?: string } | undefined>
  >();
  try {
    toolPermissionPolicy({
      registerCommand() {},
      registerEntryRenderer() {},
      on(
        event: string,
        handler: (
          event: {
            toolName: string;
            toolCallId: string;
            input: { path: string };
          },
          ctx: { cwd: string; hasUI: boolean; ui: { notify: () => void } },
        ) => Promise<{ block?: boolean; reason?: string } | undefined>,
      ) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [],
    } as never);
    const result = await handlers.get("tool_call")?.(
      {
        toolName: "read",
        toolCallId: "wasm-allow-aiignore-read",
        input: { path: "secret.txt" },
      },
      { cwd, hasUI: false, ui: { notify() {} } },
    );
    assert.equal(result, undefined);
  } finally {
    restore();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(packageDir, { recursive: true, force: true });
  }
});

test("a disabled native package fails at load instead of using TypeScript .aiignore", () => {
  const previous = process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
  process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = "1";
  const handlers: string[] = [];
  try {
    assert.throws(
      () =>
        toolPermissionPolicy({
          registerCommand() {},
          registerEntryRenderer() {},
          on(event: string) {
            handlers.push(event);
          },
          getAllTools: () => [],
        } as never),
      /wasm|native|unavailable|did not load|no alternate/i,
    );
    assert.equal(handlers.includes("tool_call"), false);
  } finally {
    if (previous === undefined)
      delete process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE;
    else process.env.PI_TOOL_PERMISSIONS_NATIVE_DISABLE = previous;
  }
});

test("a registered read allows an outside path when WASM allows it", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-path-trust-outside-read-"));
  const cwd = join(root, "project");
  const outside = join(root, "outside.txt");
  const agentDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-outside-read-agent-"),
  );
  mkdirSync(cwd);
  writeFileSync(outside, "hello");
  const packageDir = mkdtempSync(
    join(tmpdir(), "pi-path-trust-outside-read-native-"),
  );
  const packagePath = join(packageDir, "index.cjs");
  writePathTrustNativePackage(packagePath, [
    "exports.evaluatePathTrust = (request, realpath) => ({",
    "  version: 1,",
    "  operation: 'path_trust',",
    "  ok: true,",
    "  nonce: request.nonce,",
    "  path: realpath(request.requestedPath),",
    "  cwd: realpath(request.cwd),",
    "  trustEligible: true,",
    "  aiignoreMatch: false,",
    "  decision: 'allow',",
    "});",
  ]);
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
      registerEntryRenderer() {},
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
        toolCallId: "wasm-allow-outside-read",
        input: { path: outside },
      },
      { cwd, hasUI: false, ui: { notify() {} } },
    );
    assert.equal(result, undefined);
  } finally {
    restore();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(root, { recursive: true, force: true });
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(packageDir, { recursive: true, force: true });
  }
});
