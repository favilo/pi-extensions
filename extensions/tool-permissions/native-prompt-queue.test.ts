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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
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
    () => ({ decision: PromptQueueDecision.Allow }),
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
    async () => ({ decision: PromptQueueDecision.Allow }),
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
    return activeDecision.promise.then((decision) => ({ decision }));
  });
  const second = presentBoundPrompt(
    requestFor("call-second"),
    async (prompt) => {
      presented.push(prompt.toolCallId);
      return { decision: PromptQueueDecision.Deny };
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

test("a native queue fails closed on UI rejection before presenting the next module's prompt", async () => {
  const firstModule = await import(
    new URL("./native-prompt-queue.ts?extension=first", import.meta.url).href
  );
  const secondModule = await import(
    new URL("./native-prompt-queue.ts?extension=second", import.meta.url).href
  );
  const presented: string[] = [];
  const rejectedUi = deferred<PromptQueueDecision>();
  const requestFor = (toolCallId: string) => ({
    version: NATIVE_CONTRACT_VERSION,
    operation: "prompt_queue" as const,
    nonce: NATIVE_PROMPT_QUEUE_NONCE,
    toolCallId,
  });

  const first = firstModule.presentBoundPrompt(
    requestFor("call-rejected-ui"),
    async (prompt) => {
      presented.push(prompt.toolCallId);
      return rejectedUi.promise.then((decision) => ({ decision }));
    },
  );
  const second = secondModule.presentBoundPrompt(
    requestFor("call-after-rejection"),
    async (prompt) => {
      presented.push(prompt.toolCallId);
      return { decision: PromptQueueDecision.Allow };
    },
  );

  await Promise.resolve();
  assert.deepEqual(presented, ["call-rejected-ui"]);
  rejectedUi.reject(new Error("Pi UI failed"));

  assert.deepEqual(await first, {
    version: NATIVE_CONTRACT_VERSION,
    operation: "prompt_queue",
    ok: false,
    nonce: NATIVE_PROMPT_QUEUE_NONCE,
    toolCallId: "call-rejected-ui",
    decision: PromptQueueDecision.Deny,
  });
  assert.deepEqual(await second, {
    version: NATIVE_CONTRACT_VERSION,
    operation: "prompt_queue",
    ok: true,
    nonce: NATIVE_PROMPT_QUEUE_NONCE,
    toolCallId: "call-after-rejection",
    decision: PromptQueueDecision.Allow,
  });
  assert.deepEqual(presented, ["call-rejected-ui", "call-after-rejection"]);
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
