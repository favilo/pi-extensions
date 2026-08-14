import assert from "node:assert/strict";
import test from "node:test";
import { createChildRuntime, createChildRuntimeFromSelection, getPublishedChildRuntimeApi } from "./account-runtime.ts";

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

