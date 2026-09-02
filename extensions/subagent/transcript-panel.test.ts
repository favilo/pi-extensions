import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import type { NormalizedBackgroundEvent } from "./background-events.ts";
import { createPanelManager, createSubagentTranscriptPanel, renderSubagentTabBar, type SubagentTranscriptPanelOptions } from "./transcript-panel.ts";

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

test("renders the prompt passed to the subagent tool", () => {
  const panel = createSubagentTranscriptPanel({
    childId: "child-prompt-1",
    status: "running",
    cwd: "/workspace/sub-task",
    taskPrompt: "Inspect the repo and run the focused tests.",
    theme: dummyTheme,
  });

  const text = panel.render(100).join("\n");
  assert.match(text, /Prompt:/);
  assert.match(text, /Inspect the repo and run the focused tests\./);
});

test("coalesces streamed assistant text deltas before wrapping", () => {
  const panel = createSubagentTranscriptPanel({
    childId: "child-streamed-output",
    status: "completed",
    cwd: "/workspace/sub-task",
    theme: dummyTheme,
  });

  for (const [index, text] of ["Sub", "agent", " tool", " launched", " and", " completed", " successfully", "."].entries()) {
    panel.addEvent({
      childId: "child-streamed-output",
      sequence: index + 1,
      type: "assistant-text",
      payload: { text },
      truncated: false,
    });
  }

  const lines = panel.render(120);
  const rendered = lines.join("\n");
  assert.match(rendered, /Subagent tool launched and completed successfully\./);
  assert.doesNotMatch(rendered, /Sub\nagent\n tool\n launched/);
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

test("renders a subagent tab bar with active tab and dismiss shortcut hint", () => {
  const lines = renderSubagentTabBar({
    panels: ["main", "aaaaaaaa-bbbb", "cccccccc-dddd"],
    activePanelId: "cccccccc-dddd",
    theme: dummyTheme,
  }, 100);

  const text = lines.join("\n");
  assert.match(text, /1:aaaaaaaa/);
  assert.match(text, /\[2:cccccccc\]/);
  assert.match(text, /d dismiss/);
});

test("guarantees no rendered line exceeds the requested terminal width", () => {
  const panel = createSubagentTranscriptPanel({
    childId: "child-oversized-12345678901234567890",
    status: "running",
    cwd: "/workspace/very/long/path/that/exceeds/normal/width/bounds/in/terminal",
    theme: dummyTheme,
  });

  const hugeText = "x".repeat(500);
  panel.addEvent({
    childId: "child-oversized",
    sequence: 1,
    type: "assistant-text",
    payload: { text: hugeText },
    truncated: false,
  });

  panel.addEvent({
    childId: "child-oversized",
    sequence: 2,
    type: "tool-call",
    payload: { toolName: "read", input: { path: hugeText } },
    truncated: false,
  });

  const width = 80;
  const lines = panel.render(width);
  assert.equal(lines.length > 0, true);

  for (let i = 0; i < lines.length; i++) {
    const lineWidth = visibleWidth(lines[i] ?? "");
    assert.equal(
      lineWidth <= width,
      true,
      `Line ${i + 1} exceeds width ${width}: ${lineWidth} chars ("${lines[i]?.slice(0, 30)}...")`,
    );
  }
});

test("renders clean tool call and result formatting for subagent-tool-request events", () => {
  const panel = createSubagentTranscriptPanel({
    childId: "child-clean-1",
    status: "running",
    cwd: "/workspace/project",
    theme: dummyTheme,
  });

  panel.addEvent({
    childId: "child-clean-1",
    sequence: 1,
    type: "tool-call",
    payload: {
      toolName: "subagent-tool-request",
      input: { toolName: "bash", input: { command: "jj status" } },
    },
    truncated: false,
  });

  panel.addEvent({
    childId: "child-clean-1",
    sequence: 2,
    type: "tool-result",
    payload: {
      toolName: "subagent-tool-request",
      result: {
        value: {
          content: [{ type: "text", text: "Working copy (@) now at: abc1234" }],
        },
      },
      isError: false,
    },
    truncated: false,
  });

  const text = panel.render(80).join("\n");
  assert.match(text, /→ \$ jj status/);
  assert.match(text, /Working copy \(@\) now at: abc1234/);
  assert.doesNotMatch(text, /"subagent-tool-request"/);
  assert.doesNotMatch(text, /"content":/);
});

test("renders steering entered in a permission prompt after the child tool result", () => {
  const panel = createSubagentTranscriptPanel({
    childId: "child-steered-1",
    status: "running",
    cwd: "/workspace/project",
    theme: dummyTheme,
  });

  panel.addEvent({
    childId: "child-steered-1",
    sequence: 1,
    type: "tool-result",
    payload: {
      toolName: "subagent-tool-request",
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            status: "allowed",
            toolName: "bash",
            steering: "please run this with extra care",
            value: { content: [{ type: "text", text: "exit code: 0" }] },
          }),
        }],
      },
      isError: false,
    },
    truncated: false,
  });

  const text = panel.render(100).join("\n");
  assert.match(text, /exit code: 0/);
  assert.match(text, /Prompt: please run this with extra care/);
  assert.doesNotMatch(text, /"steering"/);
});
