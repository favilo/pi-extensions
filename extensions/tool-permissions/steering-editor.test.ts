import assert from "node:assert";
import { test } from "node:test";
import { SteeringEditor } from "./steering-editor.ts";

test("SteeringEditor initializes with initial text and mode state", () => {
  const editor = new SteeringEditor({ initialText: "hello", vimMode: true });
  assert.equal(editor.getValue(), "hello");
  assert.equal(editor.getMode(), "insert");
});

test("SteeringEditor prototype handles basic input and text state updates", () => {
  const editor = new SteeringEditor();
  editor.handleInput("a");
  assert.equal(editor.getValue(), "a");
});
