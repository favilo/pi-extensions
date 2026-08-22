import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { hardwareCursorVisibility, terminalFocusFromInput } from "./render.ts";

test("terminal focus reporting sequences update focus state", () => {
  assert.equal(terminalFocusFromInput("\x1b[I"), true);
  assert.equal(terminalFocusFromInput("\x1b[O"), false);
  assert.equal(terminalFocusFromInput("x"), undefined);
});

test("hardware cursor is hidden while the terminal is unfocused", () => {
  assert.equal(hardwareCursorVisibility(false, true), false);
  assert.equal(hardwareCursorVisibility(true, true), true);
});

test("focus does not enable a cursor hidden by another extension", () => {
  assert.equal(hardwareCursorVisibility(false, false), false);
  assert.equal(hardwareCursorVisibility(true, false), false);
});
