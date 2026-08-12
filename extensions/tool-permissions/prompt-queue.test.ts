import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";
import {
  promptToolPermissionRequest,
  resolvePermissionDecisionForRequest,
  type PermissionContext,
} from "./index.ts";
import {
  createPermissionPromptIdentity,
  PermissionPromptQueue,
} from "./prompt-queue.ts";
import type { ToolRequest } from "./permission-boundary.ts";

type InputComponent = { handleInput(data: string): void; render(width: number): string[] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function request(actor: ToolRequest["actor"], toolName = "read", input: unknown = { path: "notes.md" }): ToolRequest {
  return { actor, toolName, input, cwd: "/workspace/project" };
}

function promptHarness() {
  const components: InputComponent[] = [];
  const context = {
    cwd: "/workspace/project",
    hasUI: true,
    mode: "tui",
    ui: {
      confirm: async () => false,
      custom<T>(factory: (
        tui: { requestRender(force?: boolean): void; stop(): void; start(): void },
        theme: unknown,
        keybindings: unknown,
        done: (value: T) => void,
      ) => unknown): Promise<T> {
        return new Promise<T>((resolve) => {
          const component = factory(
            { requestRender() {}, stop() {}, start() {} },
            { fg: (_color: string, text: string) => text, bold: (text: string) => text },
            {},
            resolve,
          );
          components.push(component as InputComponent);
        });
      },
    },
  } satisfies PermissionContext;
  return { components, context, pi: { sendUserMessage() {} } };
}

for (const actors of [
  [{ kind: "main" } as const, { kind: "child", childId: "amber-otter" } as const],
  [{ kind: "child", childId: "amber-otter" } as const, { kind: "main" } as const],
]) {
  test(`presents ${actors[0].kind} then ${actors[1].kind} prompts FIFO and requires independent decisions`, async () => {
    const { components, context, pi } = promptHarness();
    const first = promptToolPermissionRequest(pi, context, request(actors[0]));
    const second = promptToolPermissionRequest(pi, context, request(actors[1], "write", { path: "report.md" }));

    assert.equal(components.length, 1, "a later prompt must not replace the visible prompt");
    assert.match(components[0].render(100).join("\n"), new RegExp(actors[0].kind === "main" ? "main agent" : "amber-otter"));
    components[0].handleInput("\x19");
    assert.equal(await first, "allow");
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(components.length, 2);
    const pending = await Promise.race([
      second.then(() => "settled"),
      new Promise<"pending">((resolve) => setImmediate(() => resolve("pending"))),
    ]);
    assert.equal(pending, "pending", "the first decision must not settle the second request");
    components[1].handleInput("\x04");
    assert.equal(await second, "deny");
  });
}

test("binds immutable safe identity and cancels only the targeted queued request", async () => {
  const queue = new PermissionPromptQueue();
  const active = deferred<string>();
  const queuedController = new AbortController();
  let queuedPresented = false;
  const sensitiveRequest = request({ kind: "child", childId: "amber-otter" }, "read", { token: "must-not-leak" });
  const identity = createPermissionPromptIdentity(sensitiveRequest);

  assert.equal(Object.isFrozen(identity), true);
  assert.equal(Object.isFrozen(identity.actor), true);
  assert.doesNotMatch(JSON.stringify(identity), /must-not-leak/);

  const first = queue.enqueue({
    identity,
    present: async () => active.promise,
    cancel: "cancel",
  });
  const second = queue.enqueue({
    identity: createPermissionPromptIdentity(request({ kind: "main" }, "bash", { command: "pwd" })),
    present: async () => { queuedPresented = true; return "allow"; },
    cancel: "cancel",
    signal: queuedController.signal,
  });
  queuedController.abort();

  try {
    assert.equal(await second, "cancel");
    assert.equal(queuedPresented, false);
  } finally {
    active.resolve("deny");
  }
  assert.equal(await first, "deny");
});

test("closing the queue cancels active and queued prompts exactly once", async () => {
  const queue = new PermissionPromptQueue();
  const settlements: string[] = [];
  const enqueue = (actor: ToolRequest["actor"]) => queue.enqueue({
    identity: createPermissionPromptIdentity(request(actor)),
    present: (signal) => new Promise<string>((resolve) => {
      const timeout = setTimeout(() => resolve("timed-out"), 25);
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        settlements.push(actor.kind);
        resolve("cancel");
      }, { once: true });
    }),
    cancel: "cancel",
  });

  const first = enqueue({ kind: "main" });
  const second = enqueue({ kind: "child", childId: "amber-otter" });
  queue.close();
  queue.close();

  assert.deepEqual(await Promise.all([first, second]), ["cancel", "cancel"]);
  assert.deepEqual(settlements, ["main"]);
});

test("uses main-agent cwd and configured policy semantics for child requests", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-parity-"));
  const cwd = join(root, "project");
  const policy = join(root, "permissions.toml");
  mkdirSync(cwd);
  writeFileSync(join(cwd, ".aiignore"), "private/**\n", "utf8");
  writeFileSync(policy, stringifyToml({
    permissions: {
      read: {
        allow: [{ path: `^${join(cwd, "allow-listed.txt").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$` }],
        deny: [{ path: "denied\\.txt$" }],
      },
      bash: { allow: [{ command: "^pwd$" }], deny: [{ command: "^rm " }] },
    },
  }), "utf8");
  const options = { userPermissionsPath: policy, trustResolver: () => null };
  const child = { kind: "child", childId: "amber-otter" } as const;

  assert.equal(resolvePermissionDecisionForRequest({ ...request(child), cwd }, options), "allow");
  assert.equal(resolvePermissionDecisionForRequest({ ...request(child, "read", { path: "allow-listed.txt" }), cwd }, options), "allow");
  assert.equal(resolvePermissionDecisionForRequest({ ...request(child, "read", { path: "denied.txt" }), cwd }, options), "deny");
  assert.equal(resolvePermissionDecisionForRequest({ ...request(child, "read", { path: "private/secret.txt" }), cwd }, options), "deny");
  assert.equal(resolvePermissionDecisionForRequest({ ...request(child, "bash", { command: "pwd" }), cwd }, options), "allow");
  assert.equal(resolvePermissionDecisionForRequest({ ...request(child, "bash", { command: "rm report.md" }), cwd }, options), "deny");
  assert.equal(resolvePermissionDecisionForRequest({ ...request(child, "write", { path: "report.md", content: "x" }), cwd }, options), "ask");
});
