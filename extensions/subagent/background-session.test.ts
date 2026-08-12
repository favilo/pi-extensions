import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundTaskRegistry } from "./background-session.ts";
import { createBackgroundSessionController, type ManagedSubagentSession } from "./background-lifecycle.ts";

test("generates distinct opaque IDs scoped to one parent registry", () => {
  const firstRegistry = createBackgroundTaskRegistry();
  const secondRegistry = createBackgroundTaskRegistry();

  const first = firstRegistry.register("/workspace/first");
  const second = secondRegistry.register("/workspace/second");

  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(firstRegistry.get(first.id), first);
  assert.equal(secondRegistry.get(first.id), undefined);
});

test("admits only one active child until the first becomes terminal", () => {
  const registry = createBackgroundTaskRegistry();
  const first = registry.register("/workspace/first");

  assert.throws(
    () => registry.register("/workspace/second"),
    /one active background child/i,
  );

  assert.equal(registry.transition(first.id, "completed")?.terminal, true);
  assert.doesNotThrow(() => registry.register("/workspace/second"));
});

test("returns active status and stable terminal output only through explicit scoped lookup", async () => {
  let settle: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => { settle = resolve; });
  const session: ManagedSubagentSession = {
    prompt: () => pending,
    subscribe: () => () => {},
    getLastAssistantText: () => "bounded child output",
    dispose() {},
  };
  const controller = createBackgroundSessionController(async () => session);
  const foreign = createBackgroundSessionController(async () => session);
  const launched = await controller.launch({ cwd: "/workspace", parentContext: "policy", task: "inspect" });

  const active = controller.result(launched.id);
  assert.equal(active.found, true);
  assert.equal(active.status, "running");
  assert.equal("output" in active, false);
  assert.deepEqual(controller.result("unknown-child"), { found: false, status: "unknown" });
  assert.deepEqual(foreign.result(launched.id), { found: false, status: "unknown" });

  settle?.();
  await new Promise((resolve) => setImmediate(resolve));
  const completed = controller.result(launched.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.found && completed.output, "bounded child output");
  assert.deepEqual(controller.result(launched.id), completed);
});

test("tracks lifecycle states and seals the first terminal transition", () => {
  const registry = createBackgroundTaskRegistry();
  const task = registry.register("/workspace/child");

  assert.deepEqual(task, {
    id: task.id,
    cwd: "/workspace/child",
    status: "queued",
    terminal: false,
  });
  assert.equal(registry.transition(task.id, "running")?.status, "running");
  assert.equal(registry.transition(task.id, "waiting-for-permission")?.status, "waiting-for-permission");

  const completed = registry.transition(task.id, "completed");
  assert.equal(completed?.terminal, true);
  assert.equal(completed?.status, "completed");
  assert.deepEqual(registry.transition(task.id, "failed"), completed);
  assert.deepEqual(registry.get(task.id), completed);
  assert.equal(registry.transition("unknown-child", "cancelled"), undefined);
});
