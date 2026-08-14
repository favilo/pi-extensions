import assert from "node:assert/strict";
import test from "node:test";
import {
  attachChildRuntimeSelection,
  createChildRuntime,
  createChildRuntimeFromSelection,
  createChildSessionWithRuntime,
  getPublishedChildRuntimeApi,
} from "./account-runtime.ts";

test("finds the account-switcher runtime capability without importing its private storage", () => {
  const api = {
    resolve: async () => undefined,
  };
  const key = Symbol.for("pi-account-switcher.child-runtime.v1");
  (globalThis as Record<symbol, unknown>)[key] = api;
  try {
    assert.equal(getPublishedChildRuntimeApi(), api);
  } finally {
    delete (globalThis as Record<symbol, unknown>)[key];
  }
});

test("creates an isolated runtime using the account-switcher selection capability", async () => {
  const installed = { registry: undefined as unknown };
  const api = {
    resolve: async () => ({
      descriptor: Object.freeze({
        accountId: "personal",
        provider: "openai-codex",
        modelId: "gpt-5.6-terra",
        source: "explicit" as const,
      }),
      installOauth: (registry: unknown) => { installed.registry = registry; },
      consume: async () => {},
    }),
  };

  const runtime = await createChildRuntime(
    { account: "personal", model: "openai-codex/gpt-5.6-terra" },
    { provider: "openai-codex", id: "gpt-5.5" },
    api,
  );

  assert.equal(runtime?.selection.descriptor.accountId, "personal");
  assert.equal(installed.registry !== undefined, true);
  assert.notEqual(runtime?.modelRuntime, undefined);
});

test("consumes a one-shot selection only after child session construction succeeds", async () => {
  const order: string[] = [];
  let consumes = 0;
  const selection = {
    descriptor: Object.freeze({
      accountId: "personal",
      provider: "openai-codex",
      modelId: "gpt-5.6-terra",
      source: "one-shot" as const,
    }),
    installOauth() {},
    consume: async () => { consumes += 1; order.push("consume"); },
  };
  const input = {};
  attachChildRuntimeSelection(input, selection);

  const result = await createChildSessionWithRuntime(
    input,
    async () => { order.push("session"); return "child-session"; },
    async (approved) => {
      order.push("runtime");
      return { modelRuntime: {} as never, model: {}, selection: approved };
    },
  );

  assert.equal(result, "child-session");
  assert.equal(consumes, 1);
  assert.deepEqual(order, ["runtime", "session", "consume"]);

  const failedInput = {};
  attachChildRuntimeSelection(failedInput, selection);
  await assert.rejects(
    createChildSessionWithRuntime(
      failedInput,
      async () => { throw new Error("session construction failed"); },
      async (approved) => ({ modelRuntime: {} as never, model: {}, selection: approved }),
    ),
    /session construction failed/,
  );
  assert.equal(consumes, 1, "a failed child construction must retain the one-shot selection");
});

test("constructs a child runtime from its approved selection without resolving again", async () => {
  let installs = 0;
  const selection = {
    descriptor: Object.freeze({
      accountId: "personal",
      provider: "openai-codex",
      modelId: "gpt-5.6-terra",
      source: "explicit" as const,
    }),
    installOauth: () => { installs += 1; },
    consume: async () => {},
  };

  const runtime = await createChildRuntimeFromSelection(selection);

  assert.equal(installs, 1);
  assert.equal(runtime.selection, selection);
  assert.notEqual(runtime.modelRuntime, undefined);
});

