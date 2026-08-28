import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { publishToolDefinition, unpublishToolDefinition } from "../tool-registry/index.ts";
import { registerBackgroundBash } from "./index.ts";
import type { BackgroundBashSpawn } from "./lifecycle.ts";

type ToolResultLike = { content: Array<{ type: string; text?: string }>; details?: unknown; isError?: boolean };
type CapturedTool = {
  name: string;
  execute(toolCallId: string, params: Record<string, unknown>, signal: AbortSignal, onUpdate?: unknown, ctx?: { cwd: string; isIdle?: () => boolean }): Promise<ToolResultLike>;
};

function harness(spawn: BackgroundBashSpawn, idle = true) {
  const tools = new Map<string, CapturedTool>();
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const foregroundCalls: unknown[] = [];
  const messages: Array<{ message: unknown; options: unknown }> = [];
  const pi = {
    registerTool(tool: CapturedTool) {
      tools.set(tool.name, tool);
    },
    on(event: string, handler: (...args: never[]) => unknown) {
      handlers.set(event, handler);
    },
    sendMessage(message: unknown, options: unknown) {
      messages.push({ message, options });
    },
    isIdle() {
      return idle;
    },
  } as unknown as ExtensionAPI;

  publishToolDefinition({
    name: "bash",
    label: "bash",
    description: "foreground bash",
    parameters: { type: "object", properties: {} },
    async execute(_toolCallId: string, params: Record<string, unknown>) {
      foregroundCalls.push(params);
      return { content: [{ type: "text", text: "foreground result" }] } as never;
    },
  } as never);

  registerBackgroundBash(pi, { spawn });
  return {
    tools,
    handlers,
    foregroundCalls,
    messages,
    cleanup: () => unpublishToolDefinition("bash"),
  };
}

test("an authorized background launch returns its task ID before the command settles", async () => {
  const spawned: Array<{ command: string; cwd: string }> = [];
  const { tools, foregroundCalls, cleanup } = harness(({ command, cwd }) => {
    spawned.push({ command, cwd });
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    const result = await bash.execute("call-1", { command: "sleep 60", background: true }, new AbortController().signal, undefined, { cwd: "/workspace" });

    assert.deepEqual(spawned, [{ command: "sleep 60", cwd: "/workspace" }]);
    assert.equal(foregroundCalls.length, 0, "background mode must not run the foreground executor");
    const details = result.details as { id: string; status: string };
    assert.match(details.id, /^bash-/);
    assert.equal(details.status, "running");
    assert.match(result.content[0]!.text!, /bash-/);
  } finally {
    cleanup();
  }
});

test("monitor true forwards each completed output change as an attributed agent message", async () => {
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  const { tools, messages, cleanup } = harness(({ onOutput }) => {
    emit = onOutput;
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    const result = await bash.execute("call-1", { command: "watch", background: true, monitor: true }, new AbortController().signal, undefined, { cwd: "/workspace" });
    const taskId = (result.details as { id: string }).id;
    emit?.("stdout", "changed\n");

    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], {
      message: {
        customType: "background_bash_monitor",
        content: `task ${taskId} stdout [1..1]: changed`,
        display: true,
        details: { taskId, stream: "stdout", fromSequence: 1, toSequence: 1, lines: ["changed"] },
      },
      options: { deliverAs: "steer", triggerTurn: true },
    });
  } finally {
    cleanup();
  }
});

test("active sessions receive monitor messages as steering without triggering a turn", async () => {
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  const { tools, messages, cleanup } = harness(({ onOutput }) => {
    emit = onOutput;
    return { terminate() {} };
  }, false);
  try {
    const bash = tools.get("bash")!;
    await bash.execute("c1", { command: "watch", background: true, monitor: true }, new AbortController().signal, undefined, { cwd: "/w", isIdle: () => false });
    emit?.("stdout", "active\n");
    assert.deepEqual(messages[0]?.options, { deliverAs: "steer", triggerTurn: false });
  } finally {
    cleanup();
  }
});

test("monitored task sends one terminal summary after output delivery", async () => {
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  let exit: ((outcome: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const { tools, messages, cleanup } = harness(({ onOutput, onExit }) => {
    emit = onOutput;
    exit = onExit;
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    await bash.execute("c1", { command: "echo done", background: true, monitor: true }, new AbortController().signal, undefined, { cwd: "/w" });
    emit?.("stdout", "done\n");
    exit?.({ code: 0, signal: null });
    exit?.({ code: 0, signal: null });
    assert.equal(messages.length, 2);
    assert.match(String((messages.at(-1) as { message: { content: string } }).message.content), /completed/);
  } finally {
    cleanup();
  }
});

test("monitor delivery reports overflow instead of sending unbounded messages", async () => {
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  const { tools, messages, cleanup } = harness(({ onOutput }) => {
    emit = onOutput;
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    await bash.execute("c1", { command: "flood", background: true, monitor: true }, new AbortController().signal, undefined, { cwd: "/w" });
    for (let i = 0; i < 105; i++) emit?.("stdout", `line-${i}\n`);
    assert.equal(messages.length, 21);
    assert.match(String((messages.at(-1) as { message: { content: string } }).message.content), /overflow/i);
  } finally {
    cleanup();
  }
});

test("bash_task can list tasks and fetch bounded output by offset", async () => {
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  const { tools, cleanup } = harness(({ onOutput }) => {
    emit = onOutput;
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    const launchResult = await bash.execute("c1", { command: "watch", background: true }, new AbortController().signal, undefined, { cwd: "/w" });
    const taskId = (launchResult.details as { id: string }).id;
    emit?.("stdout", "zero\none\ntwo\n");
    const bashTask = tools.get("bash_task")!;
    const listed = await bashTask.execute("c2", { action: "list" }, new AbortController().signal, undefined, { cwd: "/w" });
    assert.equal((listed.details as { tasks: unknown[] }).tasks.length, 1);
    const output = await bashTask.execute("c3", { id: taskId, action: "output", stream: "stdout", offset: 1, limit: 1 }, new AbortController().signal, undefined, { cwd: "/w" });
    assert.deepEqual((output.details as { output: { stdout: { lines: string[] } } }).output.stdout.lines, ["one"]);
  } finally {
    cleanup();
  }
});

test("stop_monitor disables delivery without cancelling the background task", async () => {
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  let terminateCalls = 0;
  const { tools, messages, cleanup } = harness(({ onOutput }) => {
    emit = onOutput;
    return { terminate() { terminateCalls++; } };
  });
  try {
    const bash = tools.get("bash")!;
    const launchResult = await bash.execute("c1", { command: "watch", background: true, monitor: true }, new AbortController().signal, undefined, { cwd: "/w" });
    const taskId = (launchResult.details as { id: string }).id;
    const bashTask = tools.get("bash_task")!;
    const stopResult = await bashTask.execute("c2", { id: taskId, action: "stop_monitor" }, new AbortController().signal, undefined, { cwd: "/w" });

    emit?.("stdout", "ignored\n");
    assert.equal(messages.length, 0);
    assert.equal((stopResult.details as { monitor: string }).monitor, "stopped");
    assert.equal((controllerStatus(stopResult.details) as string), "running");
    assert.equal(terminateCalls, 0);
  } finally {
    cleanup();
  }
});

function controllerStatus(details: unknown): unknown {
  return (details as { status?: unknown }).status;
}

test("foreground bash calls keep their existing result shape when background mode is absent", async () => {
  let spawned = false;
  const { tools, foregroundCalls, cleanup } = harness(() => {
    spawned = true;
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    const result = await bash.execute("call-1", { command: "pwd" }, new AbortController().signal, undefined, { cwd: "/workspace" });

    assert.equal(spawned, false);
    assert.deepEqual(foregroundCalls, [{ command: "pwd" }]);
    assert.equal(result.content[0]!.text, "foreground result");
    assert.equal(result.details, undefined);
  } finally {
    cleanup();
  }
});

test("monitoring without background mode is rejected explicitly", async () => {
  const { tools, foregroundCalls, cleanup } = harness(() => ({ terminate() {} }));
  try {
    const bash = tools.get("bash")!;
    await assert.rejects(
      bash.execute("call-1", { command: "echo hi", monitor: true }, new AbortController().signal, undefined, { cwd: "/workspace" }),
      /monitor.*background/i,
    );
    assert.equal(foregroundCalls.length, 0);
  } finally {
    cleanup();
  }
});

test("an invalid background request fails without launching a process", async () => {
  let spawned = false;
  const { tools, cleanup } = harness(() => {
    spawned = true;
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    await assert.rejects(
      bash.execute("call-1", { background: true }, new AbortController().signal, undefined, { cwd: "/workspace" }),
      /command/i,
    );
    assert.equal(spawned, false);
  } finally {
    cleanup();
  }
});

test("lookup returns running status by task ID", async () => {
  const { tools, cleanup } = harness(() => ({ terminate() {} }));
  try {
    const bash = tools.get("bash")!;
    const launchResult = await bash.execute("c1", { command: "sleep 60", background: true }, new AbortController().signal, undefined, { cwd: "/w" });
    const taskId = (launchResult.details as { id: string }).id;

    const bashTask = tools.get("bash_task")!;
    const statusResult = await bashTask.execute("c2", { id: taskId }, new AbortController().signal, undefined, { cwd: "/w" });
    assert.equal((statusResult.details as { id: string }).id, taskId);
    assert.equal((statusResult.details as { status: string }).status, "running");
  } finally {
    cleanup();
  }
});

test("cancel terminates an active task by ID", async () => {
  let terminateCalls = 0;
  const { tools, cleanup } = harness(() => ({ terminate() { terminateCalls++; } }));
  try {
    const bash = tools.get("bash")!;
    const launchResult = await bash.execute("c1", { command: "sleep 60", background: true }, new AbortController().signal, undefined, { cwd: "/w" });
    const taskId = (launchResult.details as { id: string }).id;

    const bashTask = tools.get("bash_task")!;
    const cancelResult = await bashTask.execute("c2", { id: taskId, action: "cancel" }, new AbortController().signal, undefined, { cwd: "/w" });
    assert.equal((cancelResult.details as { status: string }).status, "cancelled");
    assert.equal(terminateCalls, 1);
  } finally {
    cleanup();
  }
});

test("unknown task ID returns not found", async () => {
  const { tools, cleanup } = harness(() => ({ terminate() {} }));
  try {
    const bashTask = tools.get("bash_task")!;
    const result = await bashTask.execute("c1", { id: "unknown" }, new AbortController().signal, undefined, { cwd: "/w" });
    assert.equal((result.details as { found: boolean }).found, false);
  } finally {
    cleanup();
  }
});

test("session shutdown prevents late monitor messages", async () => {
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  const { tools, handlers, messages, cleanup } = harness(({ onOutput }) => {
    emit = onOutput;
    return { terminate() {} };
  });
  try {
    const bash = tools.get("bash")!;
    await bash.execute("c1", { command: "watch", background: true, monitor: true }, new AbortController().signal, undefined, { cwd: "/w" });
    handlers.get("session_shutdown")?.({ reason: "quit" } as never, {} as never);
    emit?.("stdout", "late\n");
    assert.equal(messages.length, 0);
  } finally {
    cleanup();
  }
});

test("session shutdown cancels active background work and rejects new launches", async () => {
  let terminateCalls = 0;
  const { tools, handlers, cleanup } = harness(() => ({ terminate() { terminateCalls++; } }));
  try {
    const bash = tools.get("bash")!;
    await bash.execute("c1", { command: "sleep 60", background: true }, new AbortController().signal, undefined, { cwd: "/w" });

    handlers.get("session_shutdown")?.({ reason: "quit" } as never, {} as never);
    assert.equal(terminateCalls, 1);

    await assert.rejects(
      bash.execute("c2", { command: "echo hi", background: true }, new AbortController().signal, undefined, { cwd: "/w" }),
      /closed/i,
    );
  } finally {
    cleanup();
  }
});
