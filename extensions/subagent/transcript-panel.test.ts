import assert from "node:assert/strict";
import test from "node:test";
import type { NormalizedBackgroundEvent } from "./background-events.ts";
import { createPanelManager, createSubagentTranscriptPanel, type SubagentTranscriptPanelOptions } from "./transcript-panel.ts";

const dummyTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("renders a read-only child transcript component from normalized events with header and status", () => {
  const options: SubagentTranscriptPanelOptions = {
    childId: "child-9999",
    status: "running",
    cwd: "/workspace/sub-task",
    theme: dummyTheme,
  };

  const panel = createSubagentTranscriptPanel(options);
  const events: NormalizedBackgroundEvent[] = [
    {
      childId: "child-9999",
      sequence: 1,
      type: "assistant-text",
      payload: { text: "Starting task execution." },
      truncated: false,
    },
    {
      childId: "child-9999",
      sequence: 2,
      type: "tool-call",
      payload: { toolCallId: "call-1", toolName: "read", input: { path: "package.json" } },
      truncated: false,
    },
    {
      childId: "child-9999",
      sequence: 3,
      type: "tool-result",
      payload: { toolCallId: "call-1", toolName: "read", result: { content: '{"name":"demo"}' }, isError: false },
      truncated: false,
    },
  ];

  for (const event of events) {
    panel.addEvent(event);
  }

  const lines = panel.render(80);
  assert.equal(lines.length > 0, true);
  const fullText = lines.join("\n");
  assert.match(fullText, /Subagent child-9999/);
  assert.match(fullText, /running/);
  assert.match(fullText, /Starting task execution/);
  assert.match(fullText, /read/);
  assert.match(fullText, /package\.json/);
});

test("updates panel status and seals rendering on child completion", () => {
  const panel = createSubagentTranscriptPanel({
    childId: "child-8888",
    status: "running",
    cwd: "/workspace/sub-task",
    theme: dummyTheme,
  });

  panel.setStatus("completed");
  const lines = panel.render(80);
  const fullText = lines.join("\n");
  assert.match(fullText, /completed/);
});

test("PanelManager cycles between main and child panels with deterministic return to main", () => {
  const manager = createPanelManager();
  assert.equal(manager.getActivePanelId(), "main");

  manager.registerChildPanel("child-101", "/workspace/1");
  manager.registerChildPanel("child-102", "/workspace/2");

  assert.equal(manager.cycleNext(), "child-101");
  assert.equal(manager.getActivePanelId(), "child-101");

  assert.equal(manager.cycleNext(), "child-102");
  assert.equal(manager.getActivePanelId(), "child-102");

  assert.equal(manager.cycleNext(), "main");
  assert.equal(manager.getActivePanelId(), "main");

  manager.selectPanel("child-102");
  assert.equal(manager.getActivePanelId(), "child-102");

  assert.equal(manager.returnToMain(), "main");
  assert.equal(manager.getActivePanelId(), "main");

  manager.selectPanel("child-101");
  manager.unregisterChildPanel("child-101");
  assert.equal(manager.getActivePanelId(), "main");
});
