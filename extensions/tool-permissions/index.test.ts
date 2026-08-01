import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";
import { resolvePermissionEditorTarget, resolveToolPermissionDecision } from "./index.ts";

const userPolicy = stringifyToml({
  permissions: {
    read: { allow: [{}], deny: [] },
    write: { allow: [{}], deny: [] },
    bash: { allow: [{}], deny: [] },
    subagent: { allow: [{}], deny: [] },
    "mcp__example__search": { allow: [{}], deny: [] },
  },
});

test("resolves bare and explicit user permission editor targets", () => {
  const userPath = join(mkdtempSync(join(tmpdir(), "pi-permissions-index-")), "permissions.toml");
  assert.deepEqual(resolvePermissionEditorTarget(undefined, "/tmp/project", { userPermissionsPath: userPath }), {
    scope: "user",
    path: userPath,
  });
  assert.deepEqual(resolvePermissionEditorTarget("user", "/tmp/project", { userPermissionsPath: userPath }), {
    scope: "user",
    path: userPath,
  });
});

test("resolves an eligible local permission editor target", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permissions-index-"));
  const cwd = join(root, "project");
  const userPath = join(root, "user", "permissions.toml");
  assert.deepEqual(resolvePermissionEditorTarget("local", cwd, {
    userPermissionsPath: userPath,
    trustResolver: () => ({ path: root, decision: true }),
  }), {
    scope: "local",
    path: join(cwd, ".pi", "permissions.toml"),
  });
});

test("refuses invalid and untrusted local permission editor targets", () => {
  const userPath = join(mkdtempSync(join(tmpdir(), "pi-permissions-index-")), "permissions.toml");
  assert.deepEqual(resolvePermissionEditorTarget("user extra", "/tmp/project", { userPermissionsPath: userPath }), {
    error: "Usage: /permissions [user|local]",
  });
  assert.deepEqual(resolvePermissionEditorTarget("local", "/tmp/project", {
    userPermissionsPath: userPath,
    trustResolver: () => null,
  }), {
    error: "Local permissions cannot be edited because this directory is not trusted.",
  });
});

test("all protected tool families use the scoped decision boundary", () => {
  const userPath = join(mkdtempSync(join(tmpdir(), "pi-permissions-index-")), "permissions.toml");
  writeFileSync(userPath, userPolicy);
  const cases: Array<[string, unknown]> = [
    ["read", { path: "/tmp/file" }],
    ["ls", { path: "/tmp" }],
    ["grep", { path: "/tmp/file", pattern: "x" }],
    ["find", { path: "/tmp" }],
    ["write", { path: "/tmp/file", content: "x" }],
    ["edit", { path: "/tmp/file", edits: [] }],
    ["bash", { command: "pwd" }],
    ["subagent", { agent: "worker", task: "inspect" }],
    ["mcp__example__search", { query: "public" }],
  ];

  for (const [toolName, input] of cases) {
    assert.equal(resolveToolPermissionDecision(toolName, input, "/tmp/project", {
      userPermissionsPath: userPath,
      trustResolver: () => null,
    }).decision, "allow", toolName);
  }
});
