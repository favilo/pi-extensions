import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { renderBackgroundBashLaunchCall, renderBackgroundBashLaunchResult, renderBashTaskCall, renderBashTaskResult } from "./renderer.ts";
import type { BackgroundBashTask } from "./lifecycle.ts";

const theme = new Proxy({}, {
  get: () => (...args: unknown[]) => String(args[args.length - 1]),
}) as never;

test("launch call renders the command with a background marker", () => {
  const text = renderBackgroundBashLaunchCall({ command: "sleep 60" }, theme).render(120).join("\n");
  assert.match(text, /\$ sleep 60/);
  assert.match(text, /background/i);
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
