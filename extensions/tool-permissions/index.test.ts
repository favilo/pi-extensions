import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";
import { resolvePermissionEditorTarget, resolveToolPermissionDecision } from "./index.ts";

const userPolicy = stringifyToml({
  permissions: {
    read: { allow: [{}], deny: [] },
    write: { allow: [{}], deny: [] },
    bash: { allow: [{}], deny: [] },
    subagent: { allow: [{}], deny: [] },
    "mcp__example__search": { allow: [{}], deny: [] },
  },
});

test("resolves bare and explicit user permission editor targets", () => {
  const userPath = join(mkdtempSync(join(tmpdir(), "pi-permissions-index-")), "permissions.toml");
  assert.deepEqual(resolvePermissionEditorTarget(undefined, "/tmp/project", { userPermissionsPath: userPath }), {
    scope: "user",
    path: userPath,
  });
  assert.deepEqual(resolvePermissionEditorTarget("user", "/tmp/project", { userPermissionsPath: userPath }), {
    scope: "user",
    path: userPath,
  });
});

test("resolves an eligible local permission editor target", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permissions-index-"));
  const cwd = join(root, "project");
  const userPath = join(root, "user", "permissions.toml");
  assert.deepEqual(resolvePermissionEditorTarget("local", cwd, {
    userPermissionsPath: userPath,
    trustResolver: () => ({ path: root, decision: true }),
  }), {
    scope: "local",
    path: join(cwd, ".pi", "permissions.toml"),
  });
});

test("refuses invalid and untrusted local permission editor targets", () => {
  const userPath = join(mkdtempSync(join(tmpdir(), "pi-permissions-index-")), "permissions.toml");
  assert.deepEqual(resolvePermissionEditorTarget("user extra", "/tmp/project", { userPermissionsPath: userPath }), {
    error: "Usage: /permissions [user|local]",
  });
  assert.deepEqual(resolvePermissionEditorTarget("local", "/tmp/project", {
    userPermissionsPath: userPath,
    trustResolver: () => null,
  }), {
    error: "Local permissions cannot be edited because this directory is not trusted.",
  });
});

test("configured custom tools allow non-interactive calls", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-permissions-agent-"));
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({
    permissions: { subagent_result: { allow: [{}], deny: [] } },
  }));
  const handlers = new Map<string, (event: { toolName: string; input: unknown }, ctx: { cwd: string; hasUI: boolean }) => Promise<unknown>>();
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    const { default: toolPermissionPolicy } = await import(`./index.ts?agent-dir=${encodeURIComponent(agentDir)}`);
    toolPermissionPolicy({
      registerCommand() {},
      on(event: string, handler: (event: { toolName: string; input: unknown }, ctx: { cwd: string; hasUI: boolean }) => Promise<unknown>) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [{ name: "subagent_result" }],
    } as never);
    assert.equal(await handlers.get("tool_call")?.({ toolName: "subagent_result", input: { id: "child-1" } }, {
      cwd: "/tmp/project",
      hasUI: false,
    }), undefined);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("all protected tool families use the scoped decision boundary", () => {
  const userPath = join(mkdtempSync(join(tmpdir(), "pi-permissions-index-")), "permissions.toml");
  writeFileSync(userPath, userPolicy);
  const cases: Array<[string, unknown]> = [
    ["read", { path: "/tmp/file" }],
    ["ls", { path: "/tmp" }],
    ["grep", { path: "/tmp/file", pattern: "x" }],
    ["find", { path: "/tmp" }],
    ["write", { path: "/tmp/file", content: "x" }],
    ["edit", { path: "/tmp/file", edits: [] }],
    ["bash", { command: "pwd" }],
    ["subagent", { agent: "worker", task: "inspect" }],
    ["mcp__example__search", { query: "public" }],
  ];

  for (const [toolName, input] of cases) {
    assert.equal(resolveToolPermissionDecision(toolName, input, "/tmp/project", {
      userPermissionsPath: userPath,
      trustResolver: () => null,
    }).decision, "allow", toolName);
  }
});

test("find_tools and find_skills policy evaluation matches generic custom-tool behavior", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-permissions-finders-"));
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({
    permissions: {
      find_tools: { allow: [{}], deny: [] },
      find_skills: { allow: [], deny: [{}] },
    },
  }));
  const emptyAgentDir = mkdtempSync(join(tmpdir(), "pi-permissions-finders-empty-"));
  writeFileSync(join(emptyAgentDir, "permissions.toml"), stringifyToml({
    permissions: {},
  }));

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const handlers = new Map<string, (event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => Promise<unknown>>();
  try {
    const { default: toolPermissionPolicy } = await import(`./index.ts?finders=${encodeURIComponent(agentDir)}`);
    toolPermissionPolicy({
      registerCommand() {},
      on(event: string, handler: (event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => Promise<unknown>) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [{ name: "find_tools" }, { name: "find_skills" }],
    } as never);

    const toolCall = handlers.get("tool_call")!;

    // 1. Configured allow rule for find_tools allows execution without prompt in headless mode
    const allowResult = await toolCall(
      { toolName: "find_tools", input: { query: "grep" } },
      { cwd: "/tmp/project", hasUI: false, mode: "json" },
    );
    assert.equal(allowResult, undefined);

    // 2. Configured deny rule for find_skills blocks execution
    const denyResult = await toolCall(
      { toolName: "find_skills", input: { query: "tdd" } },
      { cwd: "/tmp/project", hasUI: false, mode: "json" },
    );
    assert.deepEqual(denyResult, {
      block: true,
      reason: "Blocked find_skills: arguments match a configured deny rule.",
    });

    // 3. Unmatched finder without UI in empty permissions config blocks execution
    process.env.PI_CODING_AGENT_DIR = emptyAgentDir;
    const emptyHandlers = new Map<string, (event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => Promise<unknown>>();
    const { default: emptyPermissionPolicy } = await import(`./index.ts?finders-empty=${encodeURIComponent(emptyAgentDir)}`);
    emptyPermissionPolicy({
      registerCommand() {},
      on(event: string, handler: (event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => Promise<unknown>) {
        if (event === "tool_call") emptyHandlers.set(event, handler);
      },
      getAllTools: () => [{ name: "find_tools" }, { name: "find_skills" }],
    } as never);

    const unmatchedResult = await emptyHandlers.get("tool_call")!(
      { toolName: "find_tools", input: { query: "unmatched" } },
      { cwd: "/tmp/project", hasUI: false, mode: "json" },
    );
    assert.deepEqual(unmatchedResult, {
      block: true,
      reason: "Blocked find_tools: tool use requires explicit interactive permission or an allow rule.",
    });
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});
