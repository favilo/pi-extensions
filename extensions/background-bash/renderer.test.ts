import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { renderBackgroundBashLaunchCall, renderBackgroundBashLaunchResult, renderBashTaskCall, renderBashTaskResult, renderBackgroundBashMonitorMessage } from "./renderer.ts";
import type { BackgroundBashTask } from "./lifecycle.ts";

const theme = new Proxy({}, {
  get: () => (...args: unknown[]) => String(args[args.length - 1]),
}) as never;

test("monitor messages retain visible task and stream attribution", () => {
  const text = renderBackgroundBashMonitorMessage({ content: "task bash-abc stdout [1..1]: changed" }, { expanded: false, outputPad: 0 }, theme).render(120).join("\n");
  assert.match(text, /background monitor/);
  assert.match(text, /bash-abc/);
  assert.match(text, /stdout/);
  assert.match(text, /changed/);
});

test("launch call renders a prominent background label above the command", () => {
  const text = renderBackgroundBashLaunchCall({ command: "sleep 60", monitor: true }, theme).render(120).join("\n");
  assert.match(text, /background: true/);
  assert.match(text, /monitor: true/);
  assert.match(text, /\$ sleep 60/);
  const lines = text.split("\n");
  assert.ok(lines.some((l) => /background: true/.test(l) && !/\$/.test(l)), "background: true appears on its own line above the command");
});

test("launch result shows task ID, status, and elapsed time", () => {
  const task: BackgroundBashTask = {
    id: "bash-abc123",
    command: "sleep 60",
    cwd: "/w",
    status: "running",
    terminal: false,
    startedAt: Date.now() - 3000,
  };
  const text = renderBackgroundBashLaunchResult(task, { expanded: false }, theme).render(120).join("\n");
  assert.match(text, /bash-abc123/);
  assert.match(text, /running/i);
  assert.match(text, /3s/);
});

test("launch result hides output when collapsed and shows it when expanded", () => {
  const task: BackgroundBashTask = {
    id: "bash-abc",
    command: "echo hi",
    cwd: "/w",
    status: "completed",
    terminal: true,
    exitCode: 0,
    startedAt: Date.now() - 1000,
    finishedAt: Date.now(),
    output: {
      stdout: { text: "hello\n", truncated: false, totalLines: 1, totalBytes: 6, keptBytes: 6 },
      stderr: { text: "", truncated: false, totalLines: 0, totalBytes: 0, keptBytes: 0 },
    },
  };
  const collapsed = renderBackgroundBashLaunchResult(task, { expanded: false }, theme).render(120).join("\n");
  assert.doesNotMatch(collapsed, /hello/);
  const expanded = renderBackgroundBashLaunchResult(task, { expanded: true }, theme).render(120).join("\n");
  assert.match(expanded, /hello/);
  assert.match(expanded, /stdout/i);
});

test("launch result shows truncation metadata when output is bounded", () => {
  const task: BackgroundBashTask = {
    id: "bash-abc",
    command: "yes",
    cwd: "/w",
    status: "completed",
    terminal: true,
    exitCode: 0,
    startedAt: Date.now() - 1000,
    finishedAt: Date.now(),
    output: {
      stdout: { text: "line1\n", truncated: true, totalLines: 5000, totalBytes: 100000, keptBytes: 6 },
      stderr: { text: "", truncated: false, totalLines: 0, totalBytes: 0, keptBytes: 0 },
    },
  };
  const expanded = renderBackgroundBashLaunchResult(task, { expanded: true }, theme).render(120).join("\n");
  assert.match(expanded, /truncat/i);
});

test("bash_task call renders the task ID and action", () => {
  const text = renderBashTaskCall({ id: "bash-abc", action: "cancel" }, theme).render(120).join("\n");
  assert.match(text, /bash-abc/);
  assert.match(text, /cancel/i);
});

test("bash_task list and output results render useful summaries", () => {
  const listed = renderBashTaskResult({
    tasks: [{ id: "bash-abc", command: "watch", cwd: "/w", status: "running", terminal: false }],
  }, { expanded: false }, theme).render(120).join("\n");
  assert.match(listed, /bash-abc/);
  assert.match(listed, /running/);
  assert.doesNotMatch(listed, /undefined/);

  const output = renderBashTaskResult({
    found: true,
    id: "bash-abc",
    output: { stdout: { lines: ["one", "two"], offset: 1, limit: 2, nextOffset: 3, totalLines: 3 } },
  }, { expanded: false }, theme).render(120).join("\n");
  assert.match(output, /stdout/);
  assert.match(output, /one/);
  assert.doesNotMatch(output, /undefined/);
});

test("bash_task list calls omit an empty task ID", () => {
  const text = renderBashTaskCall({ action: "list" }, theme).render(120).join("\n");
  assert.equal(text.trimEnd(), "bash_task list");
});

test("bash_task result shows task status and not-found for unknown IDs", () => {
  const found = renderBashTaskResult(
    { id: "bash-abc", command: "x", cwd: "/w", status: "completed", terminal: true, exitCode: 0, startedAt: 0, finishedAt: 0 },
    { expanded: false }, theme,
  ).render(120).join("\n");
  assert.match(found, /completed/i);

  const notFound = renderBashTaskResult(
    { found: false, id: "unknown", status: "unknown" },
    { expanded: false }, theme,
  ).render(120).join("\n");
  assert.match(notFound, /not found/i);
});
