import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBackgroundBashController, createNodeBashSpawn } from "./lifecycle.ts";

async function waitForTerminal(controller: ReturnType<typeof createBackgroundBashController>, id: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!controller.status(id)?.terminal && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("launch installs a running owned task and returns before its command settles", () => {
  let spawned = false;
  const controller = createBackgroundBashController({
    spawn({ command, cwd, onExit }) {
      spawned = true;
      assert.equal(command, "sleep 60");
      assert.equal(cwd, "/workspace");
      void onExit;
      return { terminate() {} };
    },
  });

  const launched = controller.launch({ command: "sleep 60", cwd: "/workspace" });

  assert.equal(spawned, true);
  assert.match(launched.id, /^bash-[0-9a-f-]{36}$/i);
  assert.equal(launched.status, "running");
  assert.equal(launched.terminal, false);
  assert.deepEqual(controller.status(launched.id), launched);
});

test("records a stable terminal outcome after the owned command exits", () => {
  let exit: ((outcome: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const controller = createBackgroundBashController({
    spawn({ onExit }) {
      exit = onExit;
      return { terminate() {} };
    },
  });

  const launched = controller.launch({ command: "printf done", cwd: "/workspace" });
  assert.equal(typeof launched.startedAt, "number", "launch records a start timestamp");
  exit?.({ code: 0, signal: null });

  const completed = controller.status(launched.id);
  assert.equal(completed?.status, "completed");
  assert.equal(completed?.terminal, true);
  assert.equal(completed?.exitCode, 0);
  assert.equal(completed?.output?.stdout.text, "");
  assert.equal(typeof completed?.finishedAt, "number", "terminal status records a finish timestamp");
  assert.ok(completed!.finishedAt! >= launched.startedAt!);
});

test("writes stdout and stderr to temp files when an output directory is provided", () => {
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  let exit: ((outcome: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const dir = mkdtempSync(join(tmpdir(), "bg-bash-out-"));
  try {
    const controller = createBackgroundBashController({
      spawn({ onOutput, onExit }) {
        emit = onOutput;
        exit = onExit;
        return { terminate() {} };
    },
    });
    const launched = controller.launch({ command: "run", cwd: "/workspace", outputDir: dir });
    emit?.("stdout", "hello\n");
    emit?.("stderr", "world\n");
    exit?.({ code: 0, signal: null });

    const settled = controller.status(launched.id);
    assert.ok(settled?.stdoutPath, "terminal status includes a stdout file path");
    assert.ok(settled?.stderrPath, "terminal status includes a stderr file path");
    assert.equal(readFileSync(settled!.stdoutPath!, "utf8"), "hello\n");
    assert.equal(readFileSync(settled!.stderrPath!, "utf8"), "world\n");
    controller.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cancellation terminates the owned process and seals its terminal status", () => {
  let terminateCalls = 0;
  let exit: ((outcome: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const controller = createBackgroundBashController({
    spawn({ onExit }) {
      exit = onExit;
      return { terminate() { terminateCalls++; } };
    },
  });

  const launched = controller.launch({ command: "sleep 60", cwd: "/workspace" });
  const cancelled = controller.cancel(launched.id);
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.terminal, true);
  assert.equal(cancelled?.output?.stdout.text, "");
  assert.equal(terminateCalls, 1);

  exit?.({ code: 0, signal: null });
  assert.equal(controller.status(launched.id)?.status, "cancelled");

  assert.equal(controller.cancel("unknown-task"), undefined);
  assert.equal(controller.cancel(launched.id)?.status, "cancelled");
  assert.equal(terminateCalls, 1);
});

test("runs commands through the configured shell and reports their exit outcome", async () => {
  const controller = createBackgroundBashController({ spawn: createNodeBashSpawn() });
  const launched = controller.launch({ command: "exit 3", cwd: "/tmp" });
  assert.equal(launched.status, "running", "launch returns before the command settles");

  await waitForTerminal(controller, launched.id);
  assert.equal(controller.status(launched.id)?.status, "failed", "a non-zero shell exit fails the task");
  controller.close();
});

test("cancellation terminates the entire process tree", async (t) => {
  if (process.platform === "win32") {
    t.skip("process-group termination semantics are POSIX-only in this backend");
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "bg-bash-tree-"));
  const marker = join(dir, "grandchild-survived");
  try {
    const controller = createBackgroundBashController({ spawn: createNodeBashSpawn() });
    const launched = controller.launch({ command: `(sleep 0.2; touch '${marker}') & wait`, cwd: dir });

    controller.cancel(launched.id);
    assert.equal(controller.status(launched.id)?.status, "cancelled");

    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(existsSync(marker), false, "the detached grandchild must not outlive cancellation");
    controller.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("terminal status exposes bounded attributed output and the exit outcome", () => {
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  let exit: ((outcome: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const controller = createBackgroundBashController({
    spawn({ onOutput, onExit }) {
      emit = onOutput;
      exit = onExit;
      return { terminate() {} };
    },
  });

  const launched = controller.launch({ command: "run", cwd: "/workspace" });
  emit?.("stdout", "hello\n");
  emit?.("stderr", "oops\n");

  const running = controller.status(launched.id);
  assert.equal(running?.status, "running");
  assert.equal(running?.output?.stdout.text, "hello\n");
  assert.equal(running?.output?.stderr.text, "oops\n");

  exit?.({ code: 3, signal: null });
  const settled = controller.status(launched.id);
  assert.equal(settled?.status, "failed");
  assert.equal(settled?.exitCode, 3);
  assert.equal(settled?.output?.stdout.text, "hello\n");
  assert.equal(settled?.output?.stderr.text, "oops\n");
});

test("captures real command output through the configured shell", async () => {
  const controller = createBackgroundBashController({ spawn: createNodeBashSpawn() });
  const launched = controller.launch({ command: "printf 'out-line\\n'; printf 'err-line\\n' >&2", cwd: "/tmp" });

  await waitForTerminal(controller, launched.id);
  const settled = controller.status(launched.id);
  assert.equal(settled?.status, "completed");
  assert.equal(settled?.output?.stdout.text, "out-line\n");
  assert.equal(settled?.output?.stderr.text, "err-line\n");
  controller.close();
});

test("a timed-out launch terminates the process tree and reports timed_out", async () => {
  let terminateCalls = 0;
  const controller = createBackgroundBashController({
    spawn() {
      return { terminate() { terminateCalls++; } };
    },
  });

  const launched = controller.launch({ command: "sleep 60", cwd: "/workspace", timeoutSeconds: 0.05 });
  assert.equal(launched.status, "running");

  await new Promise((resolve) => setTimeout(resolve, 250));
  const settled = controller.status(launched.id);
  assert.equal(settled?.status, "timed_out");
  assert.equal(settled?.terminal, true);
  assert.equal(settled?.output?.stdout.text, "");
  assert.equal(terminateCalls, 1);
});

test("parent abort terminates the owned process tree and invalidates late callbacks", () => {
  let terminateCalls = 0;
  let exit: ((outcome: { code: number | null; signal: NodeJS.Signals | null }) => void) | undefined;
  const invocation = new AbortController();
  const controller = createBackgroundBashController({
    spawn({ onExit }) {
      exit = onExit;
      return { terminate() { terminateCalls++; } };
    },
  });

  const launched = controller.launch({ command: "sleep 60", cwd: "/workspace", signal: invocation.signal });
  assert.equal(launched.status, "running");

  invocation.abort();
  assert.equal(controller.status(launched.id)?.status, "cancelled");
  assert.equal(terminateCalls, 1);

  exit?.({ code: 0, signal: null });
  assert.equal(controller.status(launched.id)?.status, "cancelled", "a late exit must not resurrect an aborted task");
});

test("a launch with an already-aborted parent signal is rejected before spawning", () => {
  let spawned = false;
  const controller = createBackgroundBashController({
    spawn() {
      spawned = true;
      return { terminate() {} };
    },
  });
  const invocation = new AbortController();
  invocation.abort();

  assert.throws(
    () => controller.launch({ command: "sleep 60", cwd: "/workspace", signal: invocation.signal }),
    /cancelled|aborted/i,
  );
  assert.equal(spawned, false, "no process may launch after the parent abort");
});

test("closing the parent registry cancels active work once and rejects new launches", () => {
  let terminateCalls = 0;
  const controller = createBackgroundBashController({
    spawn() {
      return { terminate() { terminateCalls++; } };
    },
  });

  const launched = controller.launch({ command: "sleep 60", cwd: "/workspace" });
  controller.close();
  controller.close();

  const closed = controller.status(launched.id);
  assert.equal(closed?.status, "cancelled");
  assert.equal(closed?.terminal, true);
  assert.equal(terminateCalls, 1);
  assert.throws(() => controller.launch({ command: "printf stale", cwd: "/workspace" }), /closed/i);
});
