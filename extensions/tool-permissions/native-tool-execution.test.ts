import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  NATIVE_TOOL_EXECUTION_NONCE,
  executeSequencedTool,
} from "./native-tool-execution.ts";

const originalInput = JSON.stringify({ path: "/tmp/note.txt" });

function allowRequest() {
  return {
    version: NATIVE_CONTRACT_VERSION,
    operation: "tool_execution" as const,
    nonce: NATIVE_TOOL_EXECUTION_NONCE,
    decision: "allow",
    toolName: "read",
    inputJson: originalInput,
  };
}

test("an allow executes the host callback once with the original request", async () => {
  const calls: Array<{ toolName: string; inputJson: string }> = [];
  const result = await executeSequencedTool(
    allowRequest(),
    async (toolName, inputJson) => {
      calls.push({ toolName, inputJson });
      return JSON.stringify("file-body");
    },
  );
  console.log(
    JSON.stringify({
      decision: "allow",
      executions: calls.length,
      toolName: calls[0]?.toolName,
      inputJson: calls[0]?.inputJson,
    }),
  );

  assert.deepEqual(calls, [{ toolName: "read", inputJson: originalInput }]);
  assert.deepEqual(
    {
      ok: result.ok,
      executions: result.executions,
      decision: result.decision,
      valueJson: result.valueJson,
    },
    {
      ok: true,
      executions: 1,
      decision: "allow",
      valueJson: JSON.stringify("file-body"),
    },
  );
});
