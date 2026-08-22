import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createBackgroundEventBuffer } from "./background-events.ts";

function published(event: unknown): AgentSessionEvent {
  return event as AgentSessionEvent;
}

test("handles non-JSON tool payloads without escaping configured byte bounds", () => {
  const buffer = createBackgroundEventBuffer("child-1", {
    maxEvents: 2,
    maxEventBytes: 24,
    maxTotalBytes: 12,
  });

  assert.doesNotThrow(() => buffer.append(published({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "custom",
    result: { value: 1n },
    isError: false,
  })));
  const snapshot = buffer.snapshot();
  assert.equal(snapshot.bytes <= 12, true);
  assert.equal(snapshot.truncated, true);
});

test("normalizes exposed events in order while bounding and sealing retained data", () => {
  const buffer = createBackgroundEventBuffer("child-1", {
    maxEvents: 4,
    maxEventBytes: 96,
    maxTotalBytes: 320,
  });

  buffer.append(published({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "hello" },
  }));
  buffer.append(published({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_delta", delta: "private" },
  }));
  buffer.append(published({
    type: "tool_execution_start",
    toolCallId: "call-1",
    toolName: "read",
    args: { path: "notes.md" },
  }));
  buffer.append(published({
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "read",
    partialResult: { content: "first" },
  }));
  buffer.append(published({
    type: "tool_execution_update",
    toolCallId: "call-1",
    toolName: "read",
    partialResult: { content: "latest" },
  }));
  buffer.append(published({
    type: "tool_execution_end",
    toolCallId: "call-1",
    toolName: "read",
    result: { content: "x".repeat(300) },
    isError: false,
  }));

  const beforeSeal = buffer.snapshot();
  assert.deepEqual(beforeSeal.events.map((event) => event.type), [
    "assistant-text",
    "tool-call",
    "tool-update",
    "tool-result",
  ]);
  assert.deepEqual(beforeSeal.events.map((event) => event.sequence), [1, 2, 4, 5]);
  assert.equal(JSON.stringify(beforeSeal.events).includes("private"), false);
  assert.equal(JSON.stringify(beforeSeal.events).includes("first"), false);
  assert.equal(JSON.stringify(beforeSeal.events).includes("latest"), true);
  assert.equal(beforeSeal.events.every((event) => event.childId === "child-1"), true);
  assert.equal(beforeSeal.bytes <= 320, true);
  assert.equal(beforeSeal.truncated, true);
  assert.equal(beforeSeal.events.at(-1)?.truncated, true);

  buffer.seal();
  buffer.append(published({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: "late" },
  }));
  assert.deepEqual(buffer.snapshot(), beforeSeal);
});
