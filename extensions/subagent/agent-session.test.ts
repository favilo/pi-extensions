import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveToolPermissionDecision } from "../tool-permissions/index.ts";
import {
  createSubagentSession,
  runSubagentSession,
  runToolInterceptionProbe,
  validateNestingDepth,
  type SubagentSession,
} from "./agent-session.ts";

test("creates an SDK session in the child cwd and disposes it", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "pi-subagent-spike-"));
  const session = await createSubagentSession(cwd);

  assert.equal(session.cwd, cwd);
  assert.match(session.sessionId, /^[0-9a-f-]{36}$/);
  session.dispose();
});

test("runs a child turn with inherited parent context and disposes the session", async () => {
  const calls: string[] = [];
  const session: SubagentSession = {
    sessionId: "child-1",
    prompt: async (text) => {
      calls.push(`prompt:${text}`);
    },
    dispose: () => {
      calls.push("dispose");
    },
  };

  const result = await runSubagentSession({
    cwd: "/workspace/child",
    parentContext: "Repository policy: use the child cwd.",
    task: "Inspect the project.",
    createSession: async (options) => {
      calls.push(`create:${options.cwd}`);
      return session;
    },
  });

  assert.deepEqual(result, {
    sessionId: "child-1",
    cwd: "/workspace/child",
    completed: true,
    disposed: true,
  });
  assert.deepEqual(calls, [
    "create:/workspace/child",
    "prompt:Repository policy: use the child cwd.\n\nInspect the project.",
    "dispose",
  ]);
});

test("aborts and disposes a child session when cancellation occurs", async () => {
  const controller = new AbortController();
  let aborted = false;
  let disposed = false;
  const session: SubagentSession = {
    sessionId: "child-cancelled",
    prompt: async () => {
      if (!controller.signal.aborted) {
        await new Promise<void>((resolve) => {
          controller.signal.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      throw new Error("cancelled");
    },
    abort: () => {
      aborted = true;
    },
    dispose: () => {
      disposed = true;
    },
  };

  const run = runSubagentSession({
    cwd: "/workspace/child",
    parentContext: "Inherited context",
    task: "Wait for cancellation.",
    signal: controller.signal,
    createSession: async () => session,
  });
  controller.abort();
  await assert.rejects(run, /cancelled/);
  assert.equal(aborted, true);
  assert.equal(disposed, true);
});

test("routes a child tool call through the permission interceptor", async () => {
  const calls: string[] = [];
  const result = await runToolInterceptionProbe({
    call: { toolName: "read", input: { path: "notes.md" } },
    authorize: async (call) => {
      calls.push(call.toolName);
      return "allow";
    },
  });

  assert.deepEqual(result, { intercepted: true, executed: true, decision: "allow" });
  assert.deepEqual(calls, ["read"]);
});

test("routes child authorization through the existing tool-permissions resolver", async () => {
  const root = mkdtempSync(join(tmpdir(), "pi-subagent-permissions-"));
  const userPermissionsPath = join(root, "permissions.toml");
  const target = join(root, "notes.md");
  const escapedTarget = target.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
  writeFileSync(userPermissionsPath, `[[permissions.read.allow]]\npath = "^${escapedTarget}$"\n`);

  const result = await runToolInterceptionProbe({
    call: { toolName: "read", input: { path: target } },
    authorize: async (call) => {
      const decision = resolveToolPermissionDecision(call.toolName, call.input, root, { userPermissionsPath });
      return decision.decision === "allow" ? "allow" : "deny";
    },
  });

  assert.deepEqual(result, { intercepted: true, executed: true, decision: "allow" });
});

test("rejects nested agents beyond the configured depth", () => {
  assert.doesNotThrow(() => validateNestingDepth(0, 1));
  assert.throws(() => validateNestingDepth(1, 1), /maximum nesting depth/);
});

test("disposes a child session when the turn fails", async () => {
  let disposed = false;
  const session: SubagentSession = {
    sessionId: "child-failure",
    prompt: async () => {
      throw new Error("child failed");
    },
    dispose: () => {
      disposed = true;
    },
  };

  await assert.rejects(
    runSubagentSession({
      cwd: "/workspace/child",
      parentContext: "Inherited context",
      task: "Fail safely.",
      createSession: async () => session,
    }),
    /child failed/,
  );
  assert.equal(disposed, true);
});
