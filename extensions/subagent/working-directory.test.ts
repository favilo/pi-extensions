import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { resolveSubagentCwd } from "./agent-session.ts";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-subagent-cwd-"));
  mkdirSync(join(root, "nested"));
  mkdirSync(join(root, "workspace"));
  writeFileSync(join(root, "file.txt"), "fixture");
  return root;
}

test("inherits the parent cwd when no child cwd is supplied", () => {
  const root = fixture();
  assert.equal(resolveSubagentCwd(root), resolve(root));
});

test("canonicalizes a nested explicit child cwd relative to the parent", () => {
  const root = fixture();
  assert.equal(resolveSubagentCwd(root, "nested"), join(resolve(root), "nested"));
});

test("supports alternate workspace directories without a name-specific rule", () => {
  const root = fixture();
  assert.equal(resolveSubagentCwd(root, "workspace"), join(resolve(root), "workspace"));
});

test("rejects missing and non-directory child cwds before startup", () => {
  const root = fixture();
  assert.throws(() => resolveSubagentCwd(root, "missing"), /does not exist/);
  assert.throws(() => resolveSubagentCwd(root, "file.txt"), /not a directory/);
});

test("rejects symlink paths that escape the parent cwd", () => {
  const root = fixture();
  const outside = mkdtempSync(join(tmpdir(), "pi-subagent-outside-"));
  symlinkSync(outside, join(root, "escape"), "dir");
  assert.throws(() => resolveSubagentCwd(root, "escape"), /outside the parent/);
});
