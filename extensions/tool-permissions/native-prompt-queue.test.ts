import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  NATIVE_PROMPT_QUEUE_NONCE,
  PromptQueueDecision,
  presentBoundPrompt,
} from "./native-prompt-queue.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

test("an allow stays bound to the tool-call that opened the prompt", async () => {
  const toolCallId = "call-allow";
  const result = await presentBoundPrompt(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    },
    () => PromptQueueDecision.Allow,
  );
  console.log(
    JSON.stringify({
      toolCallId,
      ok: result.ok,
      boundId: result.toolCallId,
      decision: result.decision,
    }),
  );

  assert.deepEqual(
    {
      ok: result.ok,
      toolCallId: result.toolCallId,
      decision: result.decision,
    },
    { ok: true, toolCallId, decision: PromptQueueDecision.Allow },
  );
});

test("an asynchronous prompt allow stays bound to its tool-call", async () => {
  const toolCallId = "call-async-allow";
  const result = await presentBoundPrompt(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    },
    async () => PromptQueueDecision.Allow,
  );

  assert.deepEqual(
    {
      ok: result.ok,
      toolCallId: result.toolCallId,
      decision: result.decision,
    },
    { ok: true, toolCallId, decision: PromptQueueDecision.Allow },
  );
});

test("a second prompt waits until the active prompt settles", async () => {
  const activeDecision = deferred<PromptQueueDecision>();
  const presented: string[] = [];
  const requestFor = (toolCallId: string) => ({
    version: NATIVE_CONTRACT_VERSION,
    operation: "prompt_queue" as const,
    nonce: NATIVE_PROMPT_QUEUE_NONCE,
    toolCallId,
  });
  const first = presentBoundPrompt(requestFor("call-first"), async (prompt) => {
    presented.push(prompt.toolCallId);
    return activeDecision.promise;
  });
  const second = presentBoundPrompt(
    requestFor("call-second"),
    async (prompt) => {
      presented.push(prompt.toolCallId);
      return PromptQueueDecision.Deny;
    },
  );

  await Promise.resolve();
  assert.deepEqual(presented, ["call-first"]);
  activeDecision.resolve(PromptQueueDecision.Allow);

  assert.deepEqual(await first, {
    version: NATIVE_CONTRACT_VERSION,
    operation: "prompt_queue",
    ok: true,
    nonce: NATIVE_PROMPT_QUEUE_NONCE,
    toolCallId: "call-first",
    decision: PromptQueueDecision.Allow,
  });
  assert.deepEqual(await second, {
    version: NATIVE_CONTRACT_VERSION,
    operation: "prompt_queue",
    ok: true,
    nonce: NATIVE_PROMPT_QUEUE_NONCE,
    toolCallId: "call-second",
    decision: PromptQueueDecision.Deny,
  });
  assert.deepEqual(presented, ["call-first", "call-second"]);
});

test("steering stays bound to the prompt that submitted it", async () => {
  const toolCallId = "call-steering";
  const result = await presentBoundPrompt(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    },
    async () => ({
      decision: PromptQueueDecision.Steer,
      steering: "use the project policy instead",
    }),
  );

  assert.deepEqual(result, {
    version: NATIVE_CONTRACT_VERSION,
    operation: "prompt_queue",
    ok: true,
    nonce: NATIVE_PROMPT_QUEUE_NONCE,
    toolCallId,
    decision: PromptQueueDecision.Steer,
    steering: "use the project policy instead",
  });
});
