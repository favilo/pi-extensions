import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createCompletionSignalDispatcher } from "./completion-delivery.ts";
import type { BackgroundCompletionSignal } from "./background-lifecycle.ts";

function signal(id = "child-1"): BackgroundCompletionSignal {
  return {
    customType: "subagent_finished",
    content: `subagent_finished:${id}:completed`,
    display: false,
    details: { id, status: "completed" },
  };
}

const options = { deliverAs: "steer", triggerTurn: true } as const;

test("retries an unacknowledged completion after the parent settles", () => {
  const sent: unknown[] = [];
  const dispatcher = createCompletionSignalDispatcher(
    (message, delivery) => sent.push({ message, delivery }),
  );
  const completion = signal();

  dispatcher.notify(completion, options);
  assert.equal(sent.length, 1);

  dispatcher.parentSettled();
  assert.equal(sent.length, 2);

  dispatcher.observeMessage({ role: "custom", ...completion });
  dispatcher.parentSettled();
  assert.equal(sent.length, 2);
});
