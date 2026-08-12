import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import {
  createBackgroundSessionController,
  type ManagedSubagentSession,
} from "./background-lifecycle.ts";

test("installs lifecycle authority before returning without awaiting child completion", async () => {
  const calls: string[] = [];
  let settlePrompt: (() => void) | undefined;
  const promptPending = new Promise<void>((resolve) => { settlePrompt = resolve; });
  let receivedSignal: AbortSignal | undefined;

  const session: ManagedSubagentSession = {
    subscribe(_listener: (event: AgentSessionEvent) => void) {
      calls.push("subscribe");
      return () => calls.push("unsubscribe");
    },
    prompt(text) {
      calls.push(`prompt:${text}`);
      return promptPending;
    },
    dispose() {
      calls.push("dispose");
    },
  };

  const controller = createBackgroundSessionController(async ({ childId, cwd, signal }) => {
    calls.push(`create:${childId}:${cwd}`);
    receivedSignal = signal;
    return session;
  });

  const launched = await Promise.race([
    controller.launch({ cwd: "/workspace/child", parentContext: "policy", task: "inspect" }),
    new Promise<"blocked">((resolve) => setImmediate(() => resolve("blocked"))),
  ]);

  assert.notEqual(launched, "blocked");
  assert.equal(typeof launched === "object" && launched.status, "running");
  assert.equal(receivedSignal?.aborted, false);
  assert.deepEqual(calls.slice(0, 3).map((entry) => entry.split(":")[0]), ["create", "subscribe", "prompt"]);
  assert.equal(calls[2], "prompt:policy\n\ninspect");
  assert.equal(calls.includes("dispose"), false);

  settlePrompt?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.slice(-2), ["unsubscribe", "dispose"]);
});
