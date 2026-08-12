import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundResult } from "./background-lifecycle.ts";
import { subagentResultDisplay } from "./result-renderer.ts";

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
  assert.match(expanded.expandedJson ?? "", /\n    "events": \{/);
  assert.match(expanded.expandedJson ?? "", /finished ✓/);
});
