import test from "node:test";
import assert from "node:assert/strict";
import { runAgentSessionSpike, type SpikeSession } from "./agent-session-spike.ts";

test("runs a child turn with inherited parent context and disposes the session", async () => {
  const calls: string[] = [];
  const session: SpikeSession = {
    sessionId: "child-1",
    prompt: async (text) => {
      calls.push(`prompt:${text}`);
    },
    dispose: () => {
      calls.push("dispose");
    },
  };

  const result = await runAgentSessionSpike({
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

test("disposes a child session when the turn fails", async () => {
  let disposed = false;
  const session: SpikeSession = {
    sessionId: "child-failure",
    prompt: async () => {
      throw new Error("child failed");
    },
    dispose: () => {
      disposed = true;
    },
  };

  await assert.rejects(
    runAgentSessionSpike({
      cwd: "/workspace/child",
      parentContext: "Inherited context",
      task: "Fail safely.",
      createSession: async () => session,
    }),
    /child failed/,
  );
  assert.equal(disposed, true);
});
