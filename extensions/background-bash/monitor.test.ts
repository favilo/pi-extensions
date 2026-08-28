import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundBashMonitor, type BackgroundBashMonitorEvent } from "./monitor.ts";

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

test("flushes a final partial line and ignores output after close", () => {
  const events: BackgroundBashMonitorEvent[] = [];
  const monitor = createBackgroundBashMonitor((event) => events.push(event));

  monitor.append("stdout", "final change");
  monitor.flush();
  monitor.close();
  monitor.append("stdout", "late\n");

  assert.deepEqual(events, [{ stream: "stdout", sequence: 1, line: "final change" }]);
});
