import assert from "node:assert/strict";
import test from "node:test";
import { resolveSubagentRuntime, type SubagentAccount } from "./account-runtime.ts";

const accounts: SubagentAccount[] = [
  {
    id: "work",
    label: "Work",
    provider: "openai-codex",
    piAuth: {
      provider: "openai-codex",
      entry: { type: "oauth", refresh: "work-refresh", access: "work-access", expires: Date.now() + 60_000 },
    },
  },
  {
    id: "personal",
    label: "Personal",
    provider: "openai-codex",
    model: "gpt-5.6",
    piAuth: {
      provider: "openai-codex",
      entry: { type: "oauth", refresh: "personal-refresh", access: "personal-access", expires: Date.now() + 60_000 },
    },
  },
];

const parentModel = { provider: "openai-codex", id: "gpt-5.5" };

test("resolves an explicit child account without changing inherited selection", () => {
  const environment = { PI_ACCOUNT_SWITCHER_NEXT_ID: "personal", PI_ACCOUNT_SWITCHER_ACTIVE_ID: "work" };

  const runtime = resolveSubagentRuntime({ account: "work" }, accounts, parentModel, environment);

  assert.deepEqual(runtime, {
    account: accounts[0],
    accountSource: "explicit",
    model: parentModel,
    consumeOneShot: false,
  });
  assert.equal(environment.PI_ACCOUNT_SWITCHER_NEXT_ID, "personal");
});

test("uses and marks the one-shot account before the inherited account", () => {
  const runtime = resolveSubagentRuntime({}, accounts, parentModel, {
    PI_ACCOUNT_SWITCHER_NEXT_ID: "personal",
    PI_ACCOUNT_SWITCHER_ACTIVE_ID: "work",
  });

  assert.deepEqual(runtime, {
    account: accounts[1],
    accountSource: "one-shot",
    model: { provider: "openai-codex", id: "gpt-5.6" },
    consumeOneShot: true,
  });
});

test("rejects a model whose provider does not match the selected account", () => {
  assert.throws(
    () => resolveSubagentRuntime({ account: "work", model: "antigravity/gemini-3.6-flash" }, accounts, parentModel, {}),
    /does not match selected account provider/,
  );
});
