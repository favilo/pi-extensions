import assert from "node:assert";
import { test } from "node:test";
import { CURSOR_MARKER } from "@earendil-works/pi-tui";
import { SteeringEditor } from "./steering-editor.ts";

test("SteeringEditor non-Vim mode inserts text and deletes with backspace", () => {
  const editor = new SteeringEditor({ vimMode: false });
  editor.handleInput("h");
  editor.handleInput("i");
  assert.equal(editor.getValue(), "hi");
  assert.equal(editor.getMode(), "insert");

  editor.handleInput("\x7f"); // Backspace
  assert.equal(editor.getValue(), "h");
});

test("SteeringEditor Vim mode toggles between normal and insert modes via Escape and i/a", () => {
  const editor = new SteeringEditor({ vimMode: true, initialText: "foo" });
  assert.equal(editor.getMode(), "insert");

  // Escape switches to normal mode
  editor.handleInput("\x1b");
  assert.equal(editor.getMode(), "normal");

  // Normal mode keys like 'h' move cursor, do not insert text
  editor.handleInput("h");
  assert.equal(editor.getValue(), "foo");
  assert.equal(editor.getMode(), "normal");

  // 'i' returns to insert mode
  editor.handleInput("i");
  assert.equal(editor.getMode(), "insert");
  editor.handleInput("z");
  assert.equal(editor.getValue(), "fooz");
});

test("SteeringEditor Vim normal mode supports motions (0, $, w, b) and deletion (x)", () => {
  const editor = new SteeringEditor({ vimMode: true, initialText: "hello world" });
  editor.handleInput("\x1b"); // Normal mode

  // 0 moves to start
  editor.handleInput("0");
  // x deletes 'h'
  editor.handleInput("x");
  assert.equal(editor.getValue(), "ello world");

  // $ moves to end
  editor.handleInput("$");
  // x deletes 'd'
  editor.handleInput("x");
  assert.equal(editor.getValue(), "ello worl");

  // b moves back word
  editor.handleInput("b");
  editor.handleInput("i"); // insert
  editor.handleInput("A"); // insert 'A'
  assert.equal(editor.getValue(), "ello Aworl");
});

test("SteeringEditor renders mode indicator and cursor marker when focused", () => {
  const editor = new SteeringEditor({ vimMode: true, initialText: "test" });
  editor.focused = true;

  const linesInsert = editor.render(80);
  assert.ok(linesInsert.some((l) => l.includes("[INSERT]")));
  assert.ok(linesInsert.some((l) => l.includes(CURSOR_MARKER)));

  editor.handleInput("\x1b"); // Normal mode
  const linesNormal = editor.render(80);
  assert.ok(linesNormal.some((l) => l.includes("[NORMAL]")));
});

