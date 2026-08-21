import assert from "node:assert/strict";
import test from "node:test";
import type { BackgroundResult } from "./background-lifecycle.ts";
import {
  MAX_EXPANDED_RESULT_BYTES,
  subagentResultDisplay,
} from "./result-renderer.ts";

const completed: BackgroundResult = {
  found: true,
  id: "child-1234",
  cwd: "/workspace/project",
  status: "completed",
  terminal: true,
  output: "finished ✓",
  outputBytes: { original: 12, returned: 12 },
  outputTruncated: false,
};

test("keeps subagent results compact until the tool row is expanded", () => {
  const collapsed = subagentResultDisplay(completed, false);

  assert.match(collapsed.summary, /completed/i);
  assert.match(collapsed.summary, /12 bytes/i);
  assert.doesNotMatch(collapsed.summary, /truncated/i);
  assert.equal(collapsed.expandedJson, undefined);
  assert.doesNotMatch(collapsed.summary, /finished/);
});

test("pretty-prints the structured result only when expanded", () => {
  const expanded = subagentResultDisplay(completed, true);

  assert.match(expanded.expandedJson ?? "", /\n  "found": true/);
  assert.doesNotMatch(expanded.expandedJson ?? "", /"events"/);
  assert.match(expanded.expandedJson ?? "", /finished ✓/);
});

test("caps defensive expanded output without introducing event details", () => {
  const oversized = {
    ...completed,
    output: "y".repeat(MAX_EXPANDED_RESULT_BYTES),
    outputBytes: { original: MAX_EXPANDED_RESULT_BYTES, returned: MAX_EXPANDED_RESULT_BYTES },
  } as BackgroundResult;

  const json = subagentResultDisplay(oversized, true).expandedJson ?? "";
  const snapshot = JSON.parse(json) as {
    presentationTruncated?: boolean;
    events?: unknown;
    output: { presentationTruncated?: boolean };
  };

  assert.ok(Buffer.byteLength(json, "utf8") <= MAX_EXPANDED_RESULT_BYTES);
  assert.equal(snapshot.presentationTruncated, true);
  assert.equal(snapshot.events, undefined);
  assert.equal(snapshot.output.presentationTruncated, true);
});
