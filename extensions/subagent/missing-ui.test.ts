import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  promptToolPermissionRequest,
  type PermissionContext,
} from "../tool-permissions/index.ts";
import { createParentPermissionPrompt } from "./index.ts";
import {
  executeToolRequest,
  type ToolPermissionBoundary,
} from "../tool-permissions/permission-boundary.ts";

function isInputComponent(value: unknown): value is {
  handleInput(data: string): void;
  render(width: number): string[];
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "handleInput" in value &&
    typeof value.handleInput === "function" &&
    "render" in value &&
    typeof value.render === "function"
  );
}

test("omits the parent prompt adapter when the main UI is unavailable", () => {
  const prompt = createParentPermissionPrompt(
    { sendUserMessage() {} },
    "amber-otter",
    {
      cwd: "/workspace/project",
      hasUI: false,
      mode: "print",
      sessionId: "parent-session",
      ui: { confirm: async () => false },
    },
  );

  assert.equal(prompt, undefined);
});

test("returns a structured unavailable-UI denial without executing", async () => {
  let executed = false;
  const boundary: ToolPermissionBoundary = {
    evaluate: async () => "ask",
    execute: async () => {
      executed = true;
    },
  };

  const result = await executeToolRequest(
    {
      actor: { kind: "child", childId: "amber-otter" },
      toolName: "read",
      input: { path: "private-notes.md", token: "must-not-leak" },
      cwd: "/workspace/project",
      steering: "Inspect the notes.",
    },
    boundary,
  );

  assert.deepEqual(result, {
    status: "denied",
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "read",
    reason: "unavailable_ui",
    cwd: "/workspace/project",
    summary: "read requires interactive approval.",
    steering: "Inspect the notes.",
  });
  assert.equal(executed, false);
  assert.doesNotMatch(JSON.stringify(result), /private-notes|must-not-leak/);
});

test("attributes the visible prompt while marking only the requesting child as waiting", async () => {
  const statuses: string[] = [];
  const notifications: string[] = [];
  let resolvePrompt!: (value: boolean) => void;
  let notifyPromptOpened!: () => void;
  const promptOpened = new Promise<void>((resolve) => {
    notifyPromptOpened = resolve;
  });
  const prompt = createParentPermissionPrompt(
    { sendUserMessage() {} },
    "amber-otter",
    {
      cwd: "/workspace/project",
      hasUI: true,
      mode: "tui",
      sessionId: "parent-session",
      ui: {
        confirm: () =>
          new Promise<boolean>((resolve) => {
            resolvePrompt = resolve;
            notifyPromptOpened();
          }),
        notify: (message) => notifications.push(message),
      },
    },
    (status) => statuses.push(status),
  );

  const pending = prompt?.({
    actor: { kind: "child", childId: "amber-otter" },
    toolName: "read",
    input: { path: "notes.md" },
    cwd: "/workspace/project",
  });
  assert.deepEqual(statuses, ["waiting-for-permission"]);
  assert.deepEqual(notifications, [
    "Subagent amber-otter → read: permission required",
  ]);
  await promptOpened;
  resolvePrompt(false);
  await pending;
  assert.deepEqual(statuses, ["waiting-for-permission", "running"]);
});

async function openWritePrompt(): Promise<{
  pending: Promise<"allow" | "deny" | "cancel">;
  prompt: {
    handleInput(data: string): void;
    render(width: number): string[];
  };
}> {
  let notifyPromptOpened!: (component: unknown) => void;
  const promptOpened = new Promise<unknown>((resolve) => {
    notifyPromptOpened = resolve;
  });
  const context = {
    cwd: "/workspace/project",
    hasUI: true,
    mode: "tui",
    sessionId: "parent-session",
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
          notifyPromptOpened(component);
        });
      },
    },
  } satisfies PermissionContext;
  const pending = promptToolPermissionRequest(
    { sendUserMessage() {} },
    context,
    {
      actor: { kind: "child", childId: "amber-otter" },
      toolName: "write",
      input: { path: "report.md" },
      cwd: context.cwd,
    },
  );
  const promptComponent = await promptOpened;
  assert.ok(isInputComponent(promptComponent));
  return { pending, prompt: promptComponent };
}

test("Escape does not cancel an available main UI permission prompt", async () => {
  const { pending, prompt } = await openWritePrompt();
  prompt.handleInput("\x1b");
  prompt.handleInput("\x1b");

  const result = await Promise.race([
    pending.then((value) => ({ settled: true, value })),
    new Promise<{ settled: false }>((resolve) =>
      setImmediate(() => resolve({ settled: false })),
    ),
  ]);
  assert.deepEqual(result, { settled: false });
  assert.doesNotMatch(prompt.render(80).join("\n"), /Esc cancel/);
  prompt.handleInput("\x04");
  assert.equal(await pending, "deny");
});

test("Vim insert steering does not say that Escape returns", async () => {
  const previousVim = process.env.PI_VIM_MODE;
  process.env.PI_VIM_MODE = "1";
  try {
    const { pending, prompt } = await openWritePrompt();
    prompt.handleInput("\t");
    const hint = prompt.render(80).join("\n");
    assert.match(hint, /Esc normal mode/);
    assert.doesNotMatch(hint, /Esc returns/);
    prompt.handleInput("\x04");
    assert.equal(await pending, "deny");
  } finally {
    if (previousVim === undefined) delete process.env.PI_VIM_MODE;
    else process.env.PI_VIM_MODE = previousVim;
  }
});

test("reports prompt cancellation distinctly without executing", async () => {
  let executed = false;
  const decisions: string[] = [];
  const boundary = {
    evaluate: async () => "ask" as const,
    prompt: async () => "cancel" as const,
    execute: async () => {
      executed = true;
    },
    audit: (entry: { decision: string }) => decisions.push(entry.decision),
  };

  const result = await executeToolRequest(
    {
      actor: { kind: "child", childId: "amber-otter" },
      toolName: "write",
      input: { path: "report.md" },
      cwd: "/workspace/project",
      steering: "Update the report.",
    },
    boundary,
  );

  assert.equal(result.status, "cancelled");
  assert.equal(result.reason, "permission_prompt_cancelled");
  assert.equal(executed, false);
  assert.deepEqual(decisions, ["cancel_prompt"]);
});
