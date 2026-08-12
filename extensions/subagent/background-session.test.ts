import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundTaskRegistry } from "./background-session.ts";

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
