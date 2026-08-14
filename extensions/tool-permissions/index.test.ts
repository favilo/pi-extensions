import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";
import { logSubagentDebug, requiresSubagentRuntimeApproval, resolvePermissionEditorTarget, resolveToolPermissionDecision } from "./index.ts";

const userPolicy = stringifyToml({
  permissions: {
    read: { allow: [{}], deny: [] },
    write: { allow: [{}], deny: [] },
    bash: { allow: [{}], deny: [] },
    subagent: { allow: [{}], deny: [] },
    "mcp__example__search": { allow: [{}], deny: [] },
  },
});

test("debug logging hashes raw permission data and restricts the retained file mode", () => {
  const debugPath = join(tmpdir(), "pi-subagent-debug.jsonl");
  const previousDebug = process.env.PI_SUBAGENT_DEBUG;
  const previousFile = existsSync(debugPath)
    ? { content: readFileSync(debugPath), mode: statSync(debugPath).mode & 0o777 }
    : undefined;
  if (previousFile) unlinkSync(debugPath);
  process.env.PI_SUBAGENT_DEBUG = "1";

  try {
    logSubagentDebug("permission-prompt-enter", {
      request: {
        actor: { kind: "child", childId: "worker-safe" },
        toolName: "bash",
        cwd: "/workspace",
        input: { command: "curl -H 'Authorization: secret-token' https://example.invalid" },
      },
      result: { status: "allowed", value: "secret-result" },
    });

    const logged = readFileSync(debugPath, "utf8");
    assert.match(logged, /worker-safe/);
    assert.match(logged, /inputHash/);
    assert.doesNotMatch(logged, /secret-token|secret-result|Authorization|curl/);
    if (process.platform !== "win32") assert.equal(statSync(debugPath).mode & 0o077, 0);
  } finally {
    if (existsSync(debugPath)) unlinkSync(debugPath);
    if (previousFile) {
      writeFileSync(debugPath, previousFile.content, { mode: previousFile.mode });
      chmodSync(debugPath, previousFile.mode);
    }
    if (previousDebug === undefined) delete process.env.PI_SUBAGENT_DEBUG;
    else process.env.PI_SUBAGENT_DEBUG = previousDebug;
  }
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

test("requires a runtime-selection prompt for explicit and inherited subagent accounts", () => {
  assert.equal(requiresSubagentRuntimeApproval({ task: "inspect", account: "personal" }, {}), true);
  assert.equal(requiresSubagentRuntimeApproval({ task: "inspect", model: "openai-codex/gpt-5.6" }, {}), true);
  assert.equal(requiresSubagentRuntimeApproval({ task: "inspect" }, { PI_ACCOUNT_SWITCHER_NEXT_ID: "work" }), true);
  assert.equal(requiresSubagentRuntimeApproval({ task: "inspect" }, { PI_ACCOUNT_SWITCHER_ACTIVE_ID: "personal" }), true);
  assert.equal(requiresSubagentRuntimeApproval({ task: "inspect" }, {}), false);
});

test("configured subagent deny wins before child runtime resolution or a permission prompt", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-permissions-runtime-deny-"));
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({
    permissions: { subagent: { allow: [{}], deny: [{}] } },
  }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const key = Symbol.for("pi-account-switcher.child-runtime.v1");
  const originalApi = (globalThis as Record<symbol, unknown>)[key];
  let resolveCalls = 0;
  let promptCalls = 0;
  const handlers = new Map<string, (event: { toolName: string; input: Record<string, unknown>; toolCallId: string }, ctx: unknown) => Promise<unknown>>();
  (globalThis as Record<symbol, unknown>)[key] = {
    resolve: async () => {
      resolveCalls += 1;
      return undefined;
    },
  };
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const { default: toolPermissionPolicy } = await import(`./index.ts?runtime-deny=${encodeURIComponent(agentDir)}`);
    toolPermissionPolicy({
      registerCommand() {},
      on(event: string, handler: (event: { toolName: string; input: Record<string, unknown>; toolCallId: string }, ctx: unknown) => Promise<unknown>) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [{ name: "subagent" }],
    } as never);

    const result = await handlers.get("tool_call")?.({
      toolName: "subagent",
      toolCallId: "launch-denied",
      input: { task: "inspect", account: "personal" },
    }, {
      cwd: "/tmp/project",
      hasUI: true,
      mode: "tui",
      sessionId: "runtime-parent",
      ui: {
        confirm: async () => {
          promptCalls += 1;
          return true;
        },
        custom: async () => {
          promptCalls += 1;
          return undefined;
        },
      },
    });

    assert.deepEqual(result, { block: true, reason: "Blocked subagent: arguments match a configured deny rule." });
    assert.equal(resolveCalls, 0);
    assert.equal(promptCalls, 0);
  } finally {
    if (originalApi === undefined) delete (globalThis as Record<symbol, unknown>)[key];
    else (globalThis as Record<symbol, unknown>)[key] = originalApi;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("resolved child runtime fails closed without a UI despite a broad subagent allow rule", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-permissions-runtime-headless-"));
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({
    permissions: { subagent: { allow: [{}], deny: [] } },
  }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const key = Symbol.for("pi-account-switcher.child-runtime.v1");
  const originalApi = (globalThis as Record<symbol, unknown>)[key];
  let resolveCalls = 0;
  const handlers = new Map<string, (event: { toolName: string; input: Record<string, unknown>; toolCallId: string }, ctx: unknown) => Promise<unknown>>();
  (globalThis as Record<symbol, unknown>)[key] = {
    resolve: async () => {
      resolveCalls += 1;
      return {
        descriptor: Object.freeze({
          accountId: "personal",
          provider: "openai-codex",
          modelId: "gpt-5.6-terra",
          source: "explicit",
        }),
        installOauth() {},
        consume: async () => {},
      };
    },
  };
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const { default: toolPermissionPolicy } = await import(`./index.ts?runtime-headless=${encodeURIComponent(agentDir)}`);
    toolPermissionPolicy({
      registerCommand() {},
      on(event: string, handler: (event: { toolName: string; input: Record<string, unknown>; toolCallId: string }, ctx: unknown) => Promise<unknown>) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [{ name: "subagent" }],
    } as never);

    const result = await handlers.get("tool_call")?.({
      toolName: "subagent",
      toolCallId: "launch-headless",
      input: { task: "inspect", account: "personal" },
    }, {
      cwd: "/tmp/project",
      hasUI: false,
      mode: "json",
      model: { provider: "openai-codex", id: "gpt-5.5" },
      ui: {
        confirm: async () => {
          throw new Error("headless launches must not prompt");
        },
      },
    });

    assert.deepEqual(result, { block: true, reason: "Blocked subagent: selected account or model requires interactive approval." });
    assert.equal(resolveCalls, 1);
  } finally {
    if (originalApi === undefined) delete (globalThis as Record<symbol, unknown>)[key];
    else (globalThis as Record<symbol, unknown>)[key] = originalApi;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  }
});

test("resolves and displays the selected runtime before approving a broadly allowed launch", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-permissions-runtime-"));
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({
    permissions: { subagent: { allow: [{}], deny: [] } },
  }));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const key = Symbol.for("pi-account-switcher.child-runtime.v1");
  const originalApi = (globalThis as Record<symbol, unknown>)[key];
  const resolveCalls: unknown[] = [];
  const components: Array<{ handleInput(data: string): void; render(width: number): string[] }> = [];
  const handlers = new Map<string, (event: { toolName: string; input: Record<string, unknown>; toolCallId: string }, ctx: unknown) => Promise<unknown>>();
  (globalThis as Record<symbol, unknown>)[key] = {
    resolve: async (input: unknown) => {
      resolveCalls.push(input);
      return {
        descriptor: Object.freeze({
          accountId: "personal",
          provider: "openai-codex",
          modelId: "gpt-5.6-terra",
          source: "explicit",
        }),
        installOauth() {},
        consume: async () => {},
      };
    },
  };
  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const { default: toolPermissionPolicy } = await import(`./index.ts?runtime-prompt=${encodeURIComponent(agentDir)}`);
    toolPermissionPolicy({
      registerCommand() {},
      on(event: string, handler: (event: { toolName: string; input: Record<string, unknown>; toolCallId: string }, ctx: unknown) => Promise<unknown>) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [{ name: "subagent" }],
    } as never);

    const pending = handlers.get("tool_call")?.({
      toolName: "subagent",
      toolCallId: "launch-1",
      input: { task: "inspect", account: "personal" },
    }, {
      cwd: "/tmp/project",
      hasUI: true,
      mode: "tui",
      sessionId: "runtime-parent",
      model: { provider: "openai-codex", id: "gpt-5.5" },
      ui: {
        confirm: async () => false,
        custom<T>(factory: (
          tui: { requestRender(force?: boolean): void; stop(): void; start(): void },
          theme: unknown,
          keybindings: unknown,
          done: (value: T) => void,
        ) => unknown): Promise<T> {
          return new Promise<T>((resolve) => {
            components.push(factory(
              { requestRender() {}, stop() {}, start() {} },
              { fg: (_color: string, text: string) => text, bold: (text: string) => text },
              {},
              resolve,
            ) as { handleInput(data: string): void; render(width: number): string[] });
          });
        },
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolveCalls.length, 1);
    const text = components[0].render(120).join("\n");
    assert.match(text, /Account: personal/);
    assert.match(text, /Source: explicit/);
    assert.match(text, /Runtime: openai-codex\/gpt-5\.6-terra/);
    assert.match(text, /later child tool actions require separate approval/i);
    components[0].handleInput("\x04");
    assert.deepEqual(await pending, { block: true, reason: "User denied subagent delegation." });
  } finally {
    if (originalApi === undefined) delete (globalThis as Record<symbol, unknown>)[key];
    else (globalThis as Record<symbol, unknown>)[key] = originalApi;
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
