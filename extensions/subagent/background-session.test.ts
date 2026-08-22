import "../test-support/forbid-fetch.ts";
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
  assert.equal("events" in active, false);
  assert.deepEqual(controller.result("unknown-child"), { found: false, status: "unknown" });
  assert.deepEqual(foreign.result(launched.id), { found: false, status: "unknown" });

  settle?.();
  await new Promise((resolve) => setImmediate(resolve));
  const completed = controller.result(launched.id);
  assert.deepEqual(completed, {
    found: true,
    id: launched.id,
    cwd: "/workspace",
    status: "completed",
    terminal: true,
    output: "bounded child output",
    outputBytes: { original: 20, returned: 20 },
    outputTruncated: false,
  });
  assert.deepEqual(controller.result(launched.id), completed);
});

test("returns final exposed text for failed children without normalized events", async () => {
  const session: ManagedSubagentSession = {
    prompt: async () => { throw new Error("provider interrupted"); },
    subscribe: () => () => {},
    getLastAssistantText: () => "partial final answer",
    dispose() {},
  };
  const controller = createBackgroundSessionController(async () => session);
  const launched = await controller.launch({ cwd: "/workspace", parentContext: "policy", task: "inspect" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(controller.result(launched.id), {
    found: true,
    id: launched.id,
    cwd: "/workspace",
    status: "failed",
    terminal: true,
    output: "partial final answer",
    outputBytes: { original: 20, returned: 20 },
    outputTruncated: false,
  });
});

test("bounds terminal output and evicts the oldest retained result", async () => {
  const outputs = ["first child output", "ééé"];
  let created = 0;
  const controller = createBackgroundSessionController(async () => {
    const output = outputs[created++];
    return {
      prompt: async () => {},
      subscribe: () => () => {},
      getLastAssistantText: () => output,
      dispose() {},
    };
  }, { maxRetainedResults: 1, maxOutputBytes: 3 });

  const first = await controller.launch({ cwd: "/workspace/first", parentContext: "policy", task: "one" });
  await new Promise((resolve) => setImmediate(resolve));
  const second = await controller.launch({ cwd: "/workspace/second", parentContext: "policy", task: "two" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(controller.result(first.id), { found: false, status: "unknown" });
  const retained = controller.result(second.id);
  if (!retained.found || ("exported" in retained && retained.exported)) throw new Error("expected compact result");
  assert.equal(Buffer.byteLength(retained.output ?? "", "utf8") <= 3, true);
  assert.equal(retained.found && retained.output?.includes("�"), false);
  assert.deepEqual(retained.found && "outputBytes" in retained ? retained.outputBytes : undefined, {
    original: 6,
    returned: 2,
  });
  assert.equal(retained.found && retained.outputTruncated, true);
  assert.equal("events" in retained, false);
});

test("caps default terminal results at 8 KiB without returning normalized events", async () => {
  const output = "é".repeat(5_000);
  const session: ManagedSubagentSession = {
    prompt: async () => {},
    subscribe: () => () => {},
    getLastAssistantText: () => output,
    dispose() {},
  };
  const controller = createBackgroundSessionController(async () => session);
  const launched = await controller.launch({ cwd: "/workspace", parentContext: "policy", task: "inspect" });
  await new Promise((resolve) => setImmediate(resolve));

  const result = controller.result(launched.id);
  assert.equal(result.found, true);
  if (!result.found || ("exported" in result && result.exported)) throw new Error("expected compact result");
  assert.equal(Buffer.byteLength(result.output ?? "", "utf8"), 8 * 1024);
  assert.deepEqual(result.found && "outputBytes" in result ? result.outputBytes : undefined, {
    original: 10_000,
    returned: 8 * 1024,
  });
  assert.equal(result.found && result.outputTruncated, true);
  assert.equal("events" in result, false);
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
