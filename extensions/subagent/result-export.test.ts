import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createSubagentResultExporter, type SubagentExportSnapshot } from "./result-export.ts";

test("builds a schema-v1 snapshot from a SessionManager instance with full untruncated exposed events and no thinking blocks", async () => {
  const cwd = "/workspace/project";
  const sessionManager = SessionManager.inMemory(cwd);
  const largeOutput = "a".repeat(100_000);

  const messages = [
    {
      role: "user",
      content: [{ type: "text", text: "Task prompt" }],
      timestamp: 1000,
    },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private internal chain-of-thought" },
        { type: "text", text: "I will read the file." },
        { type: "toolCall", id: "call-1", name: "read", args: { path: "src/index.ts" } },
      ],
      timestamp: 1005,
    },
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "read",
      content: [{ type: "text", text: largeOutput }],
      details: { truncated: false },
      isError: false,
      timestamp: 1010,
    },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Final answer after reading." },
      ],
      timestamp: 1015,
    },
  ];

  for (const message of messages) {
    sessionManager.appendMessage(message as never);
  }

  const exporter = createSubagentResultExporter();
  const snapshot: SubagentExportSnapshot = exporter.buildSnapshot({
    id: "child-export-1234",
    cwd,
    status: "completed",
    terminal: true,
    sessionManager,
  });

  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.childId, "child-export-1234");
  assert.equal(snapshot.cwd, cwd);
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.terminal, true);
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.finalOutput, "Final answer after reading.");
  assert.equal(snapshot.events.length, 3);

  // Check event 0: text + toolCall
  assert.deepEqual(snapshot.events[0], {
    type: "assistant",
    timestamp: 1005,
    text: "I will read the file.",
    toolCalls: [{ id: "call-1", name: "read", args: { path: "src/index.ts" } }],
  });

  // Check event 1: toolResult (must retain 100,000 bytes without exporter truncation, and omit details)
  assert.equal(snapshot.events[1]?.type, "tool_result");
  assert.equal(snapshot.events[1]?.toolCallId, "call-1");
  assert.equal(snapshot.events[1]?.toolName, "read");
  assert.equal(snapshot.events[1]?.isError, false);
  assert.equal(snapshot.events[1]?.text, largeOutput);
  assert.equal("details" in (snapshot.events[1] ?? {}), false);

  // Check event 2: assistant final text
  assert.deepEqual(snapshot.events[2], {
    type: "assistant",
    timestamp: 1015,
    text: "Final answer after reading.",
    toolCalls: [],
  });

  // Verify private thinking block is nowhere in the serialized JSON
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("private internal chain-of-thought"), false);
});

test("marks incomplete snapshots for non-terminal children", () => {
  const cwd = "/workspace/project";
  const sessionManager = SessionManager.inMemory(cwd);

  sessionManager.appendMessage({
    role: "user",
    content: [{ type: "text", text: "Task prompt" }],
    timestamp: 1000,
  });

  const exporter = createSubagentResultExporter();
  const snapshot = exporter.buildSnapshot({
    id: "child-active-5678",
    cwd,
    status: "running",
    terminal: false,
    sessionManager,
  });

  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.terminal, false);
  assert.equal(snapshot.complete, false);
  assert.equal(snapshot.finalOutput, undefined);
  assert.equal(snapshot.events.length, 0);
});

test("exportToFile streams JSON atomically with 0600 mode and refuses improper overwrite targets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-export-test-"));
  const destPath = join(dir, "exported.json");
  const cwd = "/workspace/project";
  const sessionManager = SessionManager.inMemory(cwd);
  const exporter = createSubagentResultExporter();

  try {
    const res1 = await exporter.exportToFile({
      id: "child-101",
      cwd,
      status: "completed",
      terminal: true,
      sessionManager,
      destinationPath: destPath,
    });

    assert.equal(res1.success, true);
    assert.equal(res1.destinationPath, destPath);
    assert.equal(res1.overwritten, false);
    assert.equal(existsSync(destPath), true);
    if (process.platform !== "win32") {
      assert.equal(statSync(destPath).mode & 0o077, 0);
    }
    const read1 = JSON.parse(readFileSync(destPath, "utf8")) as SubagentExportSnapshot;
    assert.equal(read1.childId, "child-101");

    // Overwrite default false fails when file exists
    await assert.rejects(
      exporter.exportToFile({
        id: "child-101",
        cwd,
        status: "completed",
        terminal: true,
        sessionManager,
        destinationPath: destPath,
      }),
      /already exists/i,
    );

    // Overwrite true succeeds on regular file
    const res2 = await exporter.exportToFile({
      id: "child-101",
      cwd,
      status: "completed",
      terminal: true,
      sessionManager,
      destinationPath: destPath,
      overwrite: true,
    });
    assert.equal(res2.success, true);
    assert.equal(res2.overwritten, true);

    // Overwrite true fails on directory target
    const subDir = join(dir, "dir-target.json");
    mkdirSync(subDir);
    await assert.rejects(
      exporter.exportToFile({
        id: "child-101",
        cwd,
        status: "completed",
        terminal: true,
        sessionManager,
        destinationPath: subDir,
        overwrite: true,
      }),
      /regular file/i,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
