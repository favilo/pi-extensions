import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  NATIVE_AUDIT_WRITE_NONCE,
  recordPermissionAudit,
} from "./native-audit-write.ts";
import { recordToolAudit, setPermissionAuditHomeForTests } from "./index.ts";

function assertCurrentAlias(directory: string, datedName: string): void {
  const linkPath = join(directory, "audit.log");
  const datedPath = join(directory, datedName);
  try {
    assert.equal(readlinkSync(linkPath), datedName);
  } catch {
    const aliasStats = statSync(linkPath);
    const datedStats = statSync(datedPath);
    assert.equal(aliasStats.dev, datedStats.dev);
    assert.equal(aliasStats.ino, datedStats.ino);
  }
}

test("an allow decision appends one audit record with the current fields", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-wasm-audit-"));
  const now = "2026-07-31T12:00:00.000Z";
  const request = {
    version: NATIVE_CONTRACT_VERSION,
    operation: "audit_write" as const,
    nonce: NATIVE_AUDIT_WRITE_NONCE,
    homeDir: home,
    now,
    tool: "read",
    decision: "allow_pattern",
    cwd: "/work",
    path: "/work/notes.txt",
    reason: "user allow",
  };

  const result = recordPermissionAudit(request);
  console.log(
    JSON.stringify({
      decision: result.decision,
      tool: request.tool,
      records: result.records,
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.decision, "allow_pattern");
  assert.equal(result.records, 1);

  const directory = join(home, ".pi", "tool-permissions");
  const datedName = "audit-2026-07-31.log";
  const datedPath = join(directory, datedName);
  assert.equal(existsSync(datedPath), true);
  const lines = readFileSync(datedPath, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(record.time, now);
  assert.equal(record.tool, "read");
  assert.equal(record.decision, "allow_pattern");
  assert.equal(record.cwd, "/work");
  assert.equal(record.path, "/work/notes.txt");
  assert.equal(record.reason, "user allow");
  assert.equal("command" in record, false);
  assertCurrentAlias(directory, datedName);
});

test("a failed audit write does not leave an allow decision", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-wasm-audit-fail-"));
  const home = join(root, "blocked-home");
  writeFileSync(home, "not a directory");
  const request = {
    version: NATIVE_CONTRACT_VERSION,
    operation: "audit_write" as const,
    nonce: NATIVE_AUDIT_WRITE_NONCE,
    homeDir: home,
    now: "2026-07-31T12:00:00.000Z",
    tool: "read",
    decision: "allow_pattern",
    cwd: "/work",
    path: "/work/notes.txt",
    reason: "user allow",
  };

  const result = recordPermissionAudit(request);
  console.log(
    JSON.stringify({
      decision: result.decision,
      tool: request.tool,
      records: result.records,
    }),
  );

  assert.equal(result.ok, false);
  assert.equal(result.records, 0);
  assert.equal(result.decision, "deny");
  assert.equal(
    existsSync(join(home, ".pi", "tool-permissions", "audit-2026-07-31.log")),
    false,
  );
});

test("a host allow appends one WASM audit record and no TypeScript copy", () => {
  const home = mkdtempSync(join(tmpdir(), "pi-wasm-audit-host-"));
  const now = "2026-07-31T12:00:00.000Z";
  const restore = setPermissionAuditHomeForTests(home, () => new Date(now));
  try {
    recordToolAudit({
      tool: "read",
      actor: { kind: "main" },
      decision: "allow_pattern",
      cwd: "/work",
      path: "/work/notes.txt",
      pattern: "^/work/notes\\.txt$",
      scope: "project",
      reason: "user allow",
      steering: "keep the notes",
    });
  } finally {
    restore();
  }

  const directory = join(home, ".pi", "tool-permissions");
  const datedPath = join(directory, "audit-2026-07-31.log");
  const lines = readFileSync(datedPath, "utf8").trim().split("\n");
  console.log(
    JSON.stringify({
      decision: "allow_pattern",
      tool: "read",
      records: lines.length,
    }),
  );
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(record.time, now);
  assert.equal(record.tool, "read");
  assert.equal(record.decision, "allow_pattern");
  assert.equal(record.cwd, "/work");
  assert.equal(record.path, "/work/notes.txt");
  assert.equal(record.reason, "user allow");
  assert.deepEqual(record.actor, { kind: "main" });
  assert.equal(record.pattern, "^/work/notes\\.txt$");
  assert.equal(record.scope, "project");
  assert.equal(record.steering, "keep the notes");
  assert.equal("command" in record, false);
});
