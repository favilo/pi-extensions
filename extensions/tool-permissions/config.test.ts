import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  matchesPermissionRule,
  parsePermissionRuleJson,
  parsePermissions,
  permissionDecision,
  permissionKeyForTool,
  saveAllowedRule,
  type Permissions,
} from "./config.ts";

const PERMISSIONS: Permissions = {
  read: {
    allow: [{ path: "^/workspace/" }],
    deny: [{ path: "(?:^|/)\\.env$" }],
  },
  "mcp__example_provider__search": {
    allow: [{ query: "^public", "filters.created_date_range.start_date": "^2025-" }],
    deny: [{ query: "secret" }],
  },
};

test("permissions parse from smol-toml tool-specific tables", () => {
  const serialized = stringifyToml({ permissions: PERMISSIONS });
  assert.match(serialized, /\[\[permissions\.read\.allow\]\]/);
  assert.match(serialized, /\[\[permissions\.read\.deny\]\]/);
  assert.match(serialized, /\[\[permissions\.mcp__example_provider__search\.allow\]\]/);
  assert.deepEqual(parsePermissions(serialized), PERMISSIONS);
});

test("file tools share read and write permission keys", () => {
  assert.deepEqual(["read", "ls", "grep", "find"].map(permissionKeyForTool), ["read", "read", "read", "read"]);
  assert.deepEqual(["write", "edit"].map(permissionKeyForTool), ["write", "write"]);
  assert.equal(permissionKeyForTool("mcp__example__search"), "mcp__example__search");
});

test("deny rules take precedence over allow rules", () => {
  const permission = {
    allow: [{ command: ".*" }],
    deny: [{ command: "\\brm\\s+-rf\\b" }],
  };
  assert.equal(permissionDecision(permission, { command: "rm -rf /tmp/example" }), "deny");
  assert.equal(permissionDecision(permission, { command: "pwd" }), "allow");
});

test("fields within a rule are ANDed and rules are ORed", () => {
  const permission = PERMISSIONS["mcp__example_provider__search"];
  assert.equal(permissionDecision(permission, {
    query: "public roadmap",
    filters: { created_date_range: { start_date: "2025-01-01" } },
  }), "allow");
  assert.equal(permissionDecision(permission, {
    query: "public roadmap",
    filters: { created_date_range: { start_date: "2024-01-01" } },
  }), "ask");
  assert.equal(permissionDecision(permission, { query: "secret roadmap" }), "deny");
});

test("empty rules match every invocation while missing fields do not", () => {
  assert.equal(matchesPermissionRule({}, { anything: true }), true);
  assert.equal(matchesPermissionRule({ query: ".*" }, { page_size: 1 }), false);
});

test("arrays and objects are matched as compact JSON", () => {
  assert.equal(matchesPermissionRule({ ids: "\\[\\\"one\\\",\\\"two\\\"\\]" }, { ids: ["one", "two"] }), true);
});

test("allowing an entire tool persists an empty match-all rule", () => {
  const path = join(mkdtempSync(join(tmpdir(), "pi-permissions-")), "permissions.toml");
  saveAllowedRule(path, "mcp__example__search", {});
  assert.deepEqual(parsePermissions(readFileSync(path, "utf8")), {
    "mcp__example__search": { allow: [{}], deny: [] },
  });
});

test("saving a rule preserves comments, formatting, and unrelated configuration", () => {
  const path = join(mkdtempSync(join(tmpdir(), "pi-permissions-")), "permissions.toml");
  const source = [
    "# document comment",
    "[other]",
    "enabled=true # inline comment",
    "",
    "[permissions.read]",
    "# keep this deny comment",
    "deny=[]",
    "",
    "[[permissions.read.allow]]",
    "path='^/tmp' # keep rule comment",
    "",
  ].join("\n");
  writeFileSync(path, source);

  saveAllowedRule(path, "read", { path: "^/home" });
  saveAllowedRule(path, "mcp__example__search", {});
  const saved = readFileSync(path, "utf8");
  assert.match(saved, /# document comment/);
  assert.match(saved, /enabled=true # inline comment/);
  assert.match(saved, /# keep this deny comment/);
  assert.match(saved, /path='\^\/tmp' # keep rule comment/);
  assert.equal((parseToml(saved).other as { enabled: boolean }).enabled, true);
  assert.deepEqual(parsePermissions(saved).read?.allow, [{ path: "^/tmp" }, { path: "^/home" }]);
  assert.deepEqual(parsePermissions(saved)["mcp__example__search"], { allow: [{}], deny: [] });
});

test("malformed permission rules are rejected", () => {
  assert.throws(() => parsePermissions('[permissions]\nread = { allow = [{ path = "[" }], deny = [] }\n'), /regular expression/i);
  assert.throws(() => parsePermissions('[permissions]\nread = { allow = ["all"], deny = [] }\n'), /must be a table/);
  assert.equal(parsePermissionRuleJson('{"query":"["}'), undefined);
  assert.equal(parsePermissionRuleJson("not json"), undefined);
});
