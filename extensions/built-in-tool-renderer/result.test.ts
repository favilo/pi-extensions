import assert from "node:assert/strict";
import test from "node:test";
import { toolErrorText } from "./result.ts";

test("denied writes use the denial text instead of a success message", () => {
  const result = { content: [{ type: "text", text: "User denied write." }] };
  assert.equal(toolErrorText(result, true, "Write failed"), "User denied write.");
});

test("successful writes do not produce error text", () => {
  const result = { content: [{ type: "text", text: "Successfully wrote file" }] };
  assert.equal(toolErrorText(result, false, "Write failed"), undefined);
});
