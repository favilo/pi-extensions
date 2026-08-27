import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundBashController } from "./lifecycle.ts";

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
