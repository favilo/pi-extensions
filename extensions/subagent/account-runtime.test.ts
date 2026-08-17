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

test("constructs a child runtime from any published provider selection (antigravity, openai-compat, anthropic, etc.)", async () => {
  const cases = [
    { accountId: "gemini-acc", provider: "antigravity", modelId: "gemini-2.5-pro" },
    { accountId: "compat-acc", provider: "openai-compat", modelId: "gpt-4o" },
    { accountId: "claude-acc", provider: "anthropic", modelId: "claude-3-7-sonnet" },
  ];

  for (const c of cases) {
    let installedRegistry: unknown = undefined;
    const selection = {
      descriptor: Object.freeze({
        accountId: c.accountId,
        provider: c.provider,
        modelId: c.modelId,
        source: "explicit" as const,
      }),
      installOauth: (registry: unknown) => {
        installedRegistry = registry;
        if (registry && typeof (registry as Record<string, unknown>).registerProvider === "function") {
          (registry as { registerProvider: (id: string, def: unknown) => void }).registerProvider(c.provider, {
            name: c.provider,
            baseUrl: "https://example.invalid",
            api: "openai-completions",
            models: [{ id: c.modelId, name: c.modelId, reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4096 }],
          });
        }
      },
      consume: async () => {},
    };

    const runtime = await createChildRuntimeFromSelection(selection);

    assert.equal(runtime.selection.descriptor.accountId, c.accountId);
    assert.equal(runtime.selection.descriptor.provider, c.provider);
    assert.equal(runtime.selection.descriptor.modelId, c.modelId);
    assert.notEqual(installedRegistry, undefined);
    assert.notEqual(runtime.modelRuntime, undefined);
    assert.notEqual(runtime.model, undefined);
  }
});

