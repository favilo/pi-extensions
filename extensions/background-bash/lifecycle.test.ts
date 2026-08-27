import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
  exit?.({ code: 0, signal: null });

  assert.deepEqual(controller.status(launched.id), {
    ...launched,
    status: "completed",
    terminal: true,
  });
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
  assert.deepEqual(controller.cancel(launched.id), { ...launched, status: "cancelled", terminal: true });
  assert.equal(terminateCalls, 1);

  exit?.({ code: 0, signal: null });
  assert.equal(controller.status(launched.id)?.status, "cancelled");

  assert.equal(controller.cancel("unknown-task"), undefined);
  assert.deepEqual(controller.cancel(launched.id), { ...launched, status: "cancelled", terminal: true });
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
    const launched = controller.launch({ command: `(sleep 1; touch '${marker}') & wait`, cwd: dir });

    controller.cancel(launched.id);
    assert.equal(controller.status(launched.id)?.status, "cancelled");

    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(existsSync(marker), false, "the detached grandchild must not outlive cancellation");
    controller.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

  assert.deepEqual(controller.status(launched.id), { ...launched, status: "cancelled", terminal: true });
  assert.equal(terminateCalls, 1);
  assert.throws(() => controller.launch({ command: "printf stale", cwd: "/workspace" }), /closed/i);
});
