import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundResult } from "./background-lifecycle.ts";
import {
  MAX_EXPANDED_RESULT_BYTES,
  MAX_EXPANDED_RESULT_EVENTS,
  subagentResultDisplay,
} from "./result-renderer.ts";

const completed: BackgroundResult = {
  found: true,
  id: "child-1234",
  cwd: "/workspace/project",
  status: "completed",
  terminal: true,
  events: {
    events: [{
      childId: "child-1234",
      sequence: 1,
      type: "assistant-text",
      payload: { text: "finished ✓" },
      truncated: false,
    }],
    bytes: 42,
    truncated: true,
  },
  output: "finished ✓",
};

test("keeps subagent results compact until the tool row is expanded", () => {
  const collapsed = subagentResultDisplay(completed, false);

  assert.match(collapsed.summary, /completed/i);
  assert.match(collapsed.summary, /1 event/i);
  assert.match(collapsed.summary, /truncated/i);
  assert.equal(collapsed.expandedJson, undefined);
  assert.doesNotMatch(collapsed.summary, /finished/);
});

test("pretty-prints the structured result only when expanded", () => {
  const expanded = subagentResultDisplay(completed, true);

  assert.match(expanded.expandedJson ?? "", /\n  "found": true/);
  assert.match(expanded.expandedJson ?? "", /\n  "events": \{/);
  assert.match(expanded.expandedJson ?? "", /finished ✓/);
});

test("caps expanded result details as a valid presentation snapshot", () => {
  const oversized: BackgroundResult = {
    ...completed,
    events: {
      bytes: 2 * 1024 * 1024,
      truncated: false,
      events: Array.from({ length: MAX_EXPANDED_RESULT_EVENTS + 1 }, (_, index) => ({
        ...completed.events.events[0],
        sequence: index + 1,
        payload: { text: "x".repeat(MAX_EXPANDED_RESULT_BYTES) },
      })),
    },
    output: "y".repeat(MAX_EXPANDED_RESULT_BYTES),
  };

  const json = subagentResultDisplay(oversized, true).expandedJson ?? "";
  const snapshot = JSON.parse(json) as {
    presentationTruncated?: boolean;
    events: { events: unknown[]; omitted: number };
    output: { presentationTruncated?: boolean };
  };

  assert.ok(Buffer.byteLength(json, "utf8") <= MAX_EXPANDED_RESULT_BYTES);
  assert.equal(snapshot.presentationTruncated, true);
  assert.equal(snapshot.events.events.length, MAX_EXPANDED_RESULT_EVENTS);
  assert.equal(snapshot.events.omitted, 1);
  assert.equal(snapshot.output.presentationTruncated, true);
});
