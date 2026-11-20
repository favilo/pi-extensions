import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import { promptToolPermissionRequest } from "./index.ts";
import {
  NATIVE_PROMPT_QUEUE_NONCE,
  PromptQueueDecision,
  presentBoundPrompt,
} from "./native-prompt-queue.ts";
import {
  bundledNativePackagePath,
  requireNativePackage,
} from "./native-package.ts";

type VisiblePrompt = {
  handleInput(data: string): void;
  render(width: number): string[];
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
}

test("the WASM runtime awaits a JavaScript promise without blocking the event loop", async () => {
  const native = requireNativePackage(bundledNativePackagePath()) as {
    traceAsyncPromise(promise: Promise<string>): Promise<string>;
  };
  const input = deferred<string>();
  const result = native.traceAsyncPromise(input.promise);

  assert.ok(result instanceof Promise, "the Rust tracer must return a promise");
  setImmediate(() => input.resolve("async runtime progressed"));
  assert.equal(await result, "async runtime progressed");
});

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

test(
  "a second prompt waits until the active prompt settles",
  { timeout: 5000 },
  async () => {
    const activeDecision = deferred<PromptQueueDecision>();
    const presented: string[] = [];
    const opened = deferred<void>();
    const requestFor = (toolCallId: string) => ({
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue" as const,
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    });
    const first = presentBoundPrompt(
      requestFor("call-first"),
      async (prompt) => {
        presented.push(prompt.toolCallId);
        opened.resolve();
        return activeDecision.promise.then((decision) => ({ decision }));
      },
    );
    const second = presentBoundPrompt(
      requestFor("call-second"),
      async (prompt) => {
        presented.push(prompt.toolCallId);
        return { decision: PromptQueueDecision.Deny };
      },
    );

    await opened.promise;
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
  },
);

test(
  "a native queue fails closed on UI rejection before presenting the next module's prompt",
  { timeout: 5000 },
  async () => {
    const firstModule = await import(
      new URL("./native-prompt-queue.ts?extension=first", import.meta.url).href
    );
    const secondModule = await import(
      new URL("./native-prompt-queue.ts?extension=second", import.meta.url).href
    );
    const presented: string[] = [];
    const rejectedUi = deferred<PromptQueueDecision>();
    const opened = deferred<void>();
    const requestFor = (toolCallId: string) => ({
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue" as const,
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    });

    const first = firstModule.presentBoundPrompt(
      requestFor("call-rejected-ui"),
      async (prompt: { toolCallId: string }) => {
        presented.push(prompt.toolCallId);
        opened.resolve();
        return rejectedUi.promise.then((decision) => ({ decision }));
      },
    );
    const second = secondModule.presentBoundPrompt(
      requestFor("call-after-rejection"),
      async (prompt: { toolCallId: string }) => {
        presented.push(prompt.toolCallId);
        return { decision: PromptQueueDecision.Allow };
      },
    );

    await opened.promise;
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
  },
);

test(
  "a malformed presenter result denies and releases the next prompt",
  { timeout: 5000 },
  async () => {
    const native = requireNativePackage(bundledNativePackagePath()) as {
      decidePrompt(
        request: {
          version: number;
          operation: string;
          nonce: string;
          toolCallId: string;
        },
        present: (id: string) => Promise<unknown>,
      ): Promise<{ ok: boolean; decision: string; toolCallId: string }>;
    };
    const request = (toolCallId: string) => ({
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    });
    const first = native.decidePrompt(request("malformed-first"), async () => ({
      decision: "unexpected",
    }));
    const second = native.decidePrompt(request("malformed-next"), async () => ({
      decision: PromptQueueDecision.Allow,
    }));
    assert.deepEqual(await first, {
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      ok: false,
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId: "malformed-first",
      decision: PromptQueueDecision.Deny,
    });
    assert.equal((await second).decision, PromptQueueDecision.Allow);
  },
);

test(
  "a synchronous presenter throw denies and releases the next prompt",
  { timeout: 5000 },
  async () => {
    const native = requireNativePackage(bundledNativePackagePath()) as {
      decidePrompt(
        request: {
          version: number;
          operation: string;
          nonce: string;
          toolCallId: string;
        },
        present: (id: string) => Promise<{ decision: PromptQueueDecision }>,
      ): Promise<{ ok: boolean; decision: string; toolCallId: string }>;
    };
    const request = (toolCallId: string) => ({
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    });
    const first = native.decidePrompt(request("throw-first"), () => {
      throw new Error("presenter failed");
    });
    const second = native.decidePrompt(request("throw-next"), async () => ({
      decision: PromptQueueDecision.Allow,
    }));
    assert.deepEqual(await first, {
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      ok: false,
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId: "throw-first",
      decision: PromptQueueDecision.Deny,
    });
    assert.equal((await second).decision, PromptQueueDecision.Allow);
  },
);

test(
  "the native boundary queues a later prompt until the active UI settles",
  { timeout: 5000 },
  async () => {
    type NativePromptQueue = {
      decidePrompt(
        request: {
          version: number;
          operation: string;
          nonce: string;
          toolCallId: string;
        },
        present: (
          toolCallId: string,
        ) => Promise<{ decision: PromptQueueDecision }>,
      ): Promise<unknown>;
    };
    const native = requireNativePackage(
      bundledNativePackagePath(),
    ) as NativePromptQueue;
    const activeDecision = deferred<PromptQueueDecision>();
    const presented: string[] = [];
    const opened = deferred<void>();
    const requestFor = (toolCallId: string) => ({
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId,
    });

    const first = native.decidePrompt(
      requestFor("call-native-first"),
      async (id) => {
        presented.push(id);
        opened.resolve();
        return activeDecision.promise.then((decision) => ({ decision }));
      },
    );
    const second = native.decidePrompt(
      requestFor("call-native-second"),
      async (id) => {
        presented.push(id);
        return { decision: PromptQueueDecision.Deny };
      },
    );

    await opened.promise;
    assert.deepEqual(presented, ["call-native-first"]);
    activeDecision.resolve(PromptQueueDecision.Allow);
    await Promise.all([first, second]);
    assert.deepEqual(presented, ["call-native-first", "call-native-second"]);
  },
);

test("the native presenter runs asynchronously on the JavaScript event loop", async () => {
  const native = requireNativePackage(bundledNativePackagePath()) as {
    decidePrompt(
      request: {
        version: number;
        operation: string;
        nonce: string;
        toolCallId: string;
      },
      present: (id: string) => Promise<{ decision: PromptQueueDecision }>,
    ): Promise<unknown>;
  };
  let presenterCalled = false;
  const result = native.decidePrompt(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId: "call-async-presenter",
    },
    async () => {
      presenterCalled = true;
      return { decision: PromptQueueDecision.Deny };
    },
  );

  assert.equal(presenterCalled, false, "presenter must not run inline");
  await result;
  assert.equal(presenterCalled, true);
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

test(
  "an aborted permission request cannot allow after a late UI confirmation",
  { timeout: 5000 },
  async () => {
    const controller = new AbortController();
    const confirmation = deferred<boolean>();
    const opened = deferred<void>();
    const pending = promptToolPermissionRequest(
      { sendUserMessage() {} },
      {
        cwd: "/workspace/project",
        hasUI: true,
        mode: "rpc",
        sessionId: "late-confirmation",
        signal: controller.signal,
        ui: {
          confirm: async () => {
            opened.resolve();
            return confirmation.promise;
          },
        },
      },
      {
        actor: { kind: "main" },
        toolName: "read",
        input: { path: "notes.md" },
        cwd: "/workspace/project",
        toolCallId: "late-confirmation-call",
      },
    );
    await opened.promise;
    controller.abort();
    confirmation.resolve(true);
    assert.notEqual(await pending, "allow");
  },
);

test("promptToolPermissionRequest holds the native queue until the visible prompt settles", async () => {
  const components: VisiblePrompt[] = [];
  const pending = promptToolPermissionRequest(
    { sendUserMessage() {} },
    {
      cwd: "/workspace/project",
      hasUI: true,
      mode: "tui",
      sessionId: "native-live-prompt",
      ui: {
        confirm: async () => false,
        custom<T>(
          factory: (
            tui: {
              requestRender(force?: boolean): void;
              stop(): void;
              start(): void;
            },
            theme: unknown,
            keybindings: unknown,
            done: (value: T) => void,
          ) => unknown,
        ): Promise<T> {
          return new Promise<T>((resolve) => {
            const component = factory(
              { requestRender() {}, stop() {}, start() {} },
              {
                fg: (_color: string, text: string) => text,
                bold: (text: string) => text,
              },
              {},
              resolve,
            );
            components.push(component as VisiblePrompt);
          });
        },
      },
    },
    {
      actor: { kind: "main" },
      toolName: "read",
      input: { path: "notes.md" },
      cwd: "/workspace/project",
      toolCallId: "call-live-prompt",
    },
  );

  const deadline = Date.now() + 1000;
  while (components.length === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(components.length, 1);
  assert.match(
    components[0].render(100).join("\n"),
    /Allow the main agent to use read\?/,
  );

  const native = requireNativePackage(bundledNativePackagePath()) as {
    decidePrompt(
      request: {
        version: number;
        operation: string;
        nonce: string;
        toolCallId: string;
      },
      present: (
        toolCallId: string,
      ) => Promise<{ decision: PromptQueueDecision }>,
    ): Promise<unknown>;
  };
  let nativePresented = false;
  const queued = native.decidePrompt(
    {
      version: NATIVE_CONTRACT_VERSION,
      operation: "prompt_queue",
      nonce: NATIVE_PROMPT_QUEUE_NONCE,
      toolCallId: "call-after-live-prompt",
    },
    async () => {
      nativePresented = true;
      return { decision: PromptQueueDecision.Deny };
    },
  );

  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      nativePresented,
      false,
      "promptToolPermissionRequest must hold the native queue until the visible prompt settles",
    );
    components[0].handleInput("\x04");
    assert.equal(await pending, "deny");
    await queued;
    assert.equal(nativePresented, true);
  } finally {
    if (components[0]) components[0].handleInput("\x04");
    await Promise.allSettled([pending, queued]);
  }
});
