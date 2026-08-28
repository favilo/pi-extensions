import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundBashMonitor, type BackgroundBashMonitorEvent } from "./monitor.ts";
import { createBackgroundBashController } from "./lifecycle.ts";

test("emits one ordered event for each completed stdout and stderr line", () => {
  const events: BackgroundBashMonitorEvent[] = [];
  const monitor = createBackgroundBashMonitor((event) => events.push(event));

  monitor.append("stdout", "first");
  assert.deepEqual(events, []);
  monitor.append("stdout", " line\nsecond\n");
  monitor.append("stderr", "warning\n");

  assert.deepEqual(events, [
    { stream: "stdout", sequence: 1, line: "first line" },
    { stream: "stdout", sequence: 2, line: "second" },
    { stream: "stderr", sequence: 3, line: "warning" },
  ]);
});

test("a monitored task forwards completed output changes while an unmonitored task stays silent", () => {
  const events: BackgroundBashMonitorEvent[] = [];
  let monitoredEmit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  let unmonitoredEmit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  const monitored = createBackgroundBashController({
    spawn({ onOutput }) {
      monitoredEmit = onOutput;
      return { terminate() {} };
    },
  });
  const unmonitored = createBackgroundBashController({
    spawn({ onOutput }) {
      unmonitoredEmit = onOutput;
      return { terminate() {} };
    },
  });

  monitored.launch({ command: "watch", cwd: "/workspace", monitor: true, onMonitorEvent: (event) => events.push(event) });
  unmonitored.launch({ command: "quiet", cwd: "/workspace", monitor: false, onMonitorEvent: (event) => events.push(event) });
  monitoredEmit?.("stdout", "changed\n");
  unmonitoredEmit?.("stdout", "should stay silent\n");

  assert.deepEqual(events, [{ stream: "stdout", sequence: 1, line: "changed" }]);
  monitored.close();
  unmonitored.close();
});

test("stopping a task monitor suppresses later output events without cancelling the task", () => {
  const events: BackgroundBashMonitorEvent[] = [];
  let emit: ((stream: "stdout" | "stderr", chunk: string) => void) | undefined;
  const controller = createBackgroundBashController({
    spawn({ onOutput }) {
      emit = onOutput;
      return { terminate() {} };
    },
  });
  const task = controller.launch({ command: "watch", cwd: "/workspace", monitor: true, onMonitorEvent: (event) => events.push(event) });

  assert.equal(controller.stopMonitor(task.id), true);
  emit?.("stdout", "ignored\n");
  assert.deepEqual(events, []);
  assert.equal(controller.status(task.id)?.status, "running");
  assert.equal(controller.stopMonitor(task.id), false);
  controller.close();
});

test("flushes a final partial line and ignores output after close", () => {
  const events: BackgroundBashMonitorEvent[] = [];
  const monitor = createBackgroundBashMonitor((event) => events.push(event));

  monitor.append("stdout", "final change");
  monitor.flush();
  monitor.close();
  monitor.append("stdout", "late\n");

  assert.deepEqual(events, [{ stream: "stdout", sequence: 1, line: "final change" }]);
});
