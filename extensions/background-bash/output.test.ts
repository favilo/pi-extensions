import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { createOutputCapture } from "./output.ts";

test("captures stdout and stderr separately without truncation inside the limits", () => {
  const capture = createOutputCapture();
  capture.append("stdout", "out-1\nout-2\n");
  capture.append("stderr", "err-1\n");
  capture.append("stdout", "out-3\n");

  const snapshot = capture.snapshot();
  assert.equal(snapshot.stdout.text, "out-1\nout-2\nout-3\n");
  assert.equal(snapshot.stderr.text, "err-1\n");
  assert.equal(snapshot.stdout.truncated, false);
  assert.equal(snapshot.stderr.truncated, false);
  assert.equal(snapshot.stdout.totalLines, 3);
  assert.equal(snapshot.stdout.totalBytes, Buffer.byteLength("out-1\nout-2\nout-3\n", "utf8"));
});

test("bounds captured output by line count with visible truncation metadata", () => {
  const capture = createOutputCapture({ maxLinesPerStream: 2 });
  capture.append("stdout", "one\ntwo\nthree\nfour\n");

  const snapshot = capture.snapshot();
  assert.equal(snapshot.stdout.text, "one\ntwo\n");
  assert.equal(snapshot.stdout.truncated, true);
  assert.equal(snapshot.stdout.totalLines, 4);
});

test("bounds captured output by UTF-8 bytes without splitting characters", () => {
  const capture = createOutputCapture({ maxBytesPerStream: 5 });
  capture.append("stdout", "ab🙂cd"); // 🙂 is 4 UTF-8 bytes; keeping it would exceed the 5-byte cap

  const snapshot = capture.snapshot();
  assert.equal(snapshot.stdout.text, "ab");
  assert.equal(snapshot.stdout.truncated, true);
  assert.equal(snapshot.stdout.keptBytes, 2);
  assert.equal(snapshot.stdout.totalBytes, Buffer.byteLength("ab🙂cd", "utf8"));
});
