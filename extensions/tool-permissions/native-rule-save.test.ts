import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parsePermissions } from "./config.ts";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  NATIVE_RULE_SAVE_NONCE,
  savePermissionRule,
} from "./native-rule-save.ts";
import { saveSubcommandAllowRules } from "./bash-subcommands.ts";
import { saveToolPermissionRule } from "./index.ts";

test("a user save patches the approved rule once", () => {
  const destination = join(
    mkdtempSync(join(tmpdir(), "pi-wasm-rule-save-")),
    "permissions.toml",
  );
  const rule = { path: "^/work/notes\\.txt$" };
  writeFileSync(destination, "[permissions]\n");

  const result = savePermissionRule({
    version: NATIVE_CONTRACT_VERSION,
    operation: "rule_save",
    nonce: NATIVE_RULE_SAVE_NONCE,
    destination,
    scope: "user",
    tool: "read",
    rule,
  });
  console.log(
    JSON.stringify({
      destination,
      rule,
      ok: result.ok,
      allowed: result.allowed,
    }),
  );

  assert.deepEqual(parsePermissions(readFileSync(destination, "utf8")).read, {
    allow: [rule],
    deny: [],
  });
  assert.equal(result.ok, true);
  assert.equal(result.allowed, true);
});

test("a project save patches the approved rule once", () => {
  const destination = join(
    mkdtempSync(join(tmpdir(), "pi-wasm-project-save-")),
    ".pi",
    "permissions.toml",
  );
  const rule = { path: "^/work/src$" };
  mkdirSync(join(destination, ".."), { recursive: true });
  writeFileSync(destination, "[permissions]\n");
  const before = readFileSync(destination, "utf8");

  const allowed = saveToolPermissionRule({
    destination,
    scope: "project",
    tool: "read",
    rule,
  });
  const after = readFileSync(destination, "utf8");
  const saved = parsePermissions(after).read;
  console.log(
    JSON.stringify({
      destination,
      rule,
      allowed,
      rules: saved?.allow.length ?? 0,
    }),
  );

  assert.equal(before !== after, true);
  assert.deepEqual(saved, { allow: [rule], deny: [] });
  assert.equal(allowed, true);
  assert.equal(parsePermissions(after).read?.allow.length, 1);
});

test("saving the same rule twice leaves one allow rule", () => {
  const destination = join(
    mkdtempSync(join(tmpdir(), "pi-wasm-rule-duplicate-")),
    "permissions.toml",
  );
  const rule = { path: "^/work/notes\\.txt$" };
  const existing = [
    "[permissions.read]",
    "deny = []",
    "",
    "[[permissions.read.allow]]",
    "path = '^/work/notes\\.txt$'",
    "",
  ].join("\n");
  writeFileSync(destination, existing);

  const result = savePermissionRule({
    version: NATIVE_CONTRACT_VERSION,
    operation: "rule_save",
    nonce: NATIVE_RULE_SAVE_NONCE,
    destination,
    scope: "user",
    tool: "read",
    rule,
  });
  const saved = parsePermissions(readFileSync(destination, "utf8")).read;
  console.log(
    JSON.stringify({
      destination,
      rule,
      allowed: result.allowed,
      rules: saved?.allow.length ?? 0,
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.allowed, true);
  assert.deepEqual(saved, { allow: [rule], deny: [] });
});

test("saving the same rule fields in a different order leaves one allow rule", () => {
  const destination = join(
    mkdtempSync(join(tmpdir(), "pi-wasm-rule-order-")),
    "permissions.toml",
  );
  const rule = { command: "cat", path: "^/work/notes\\.txt$" };
  const existing = [
    "[permissions.read]",
    "deny = []",
    "",
    "[[permissions.read.allow]]",
    "path = '^/work/notes\\.txt$'",
    "command = 'cat'",
    "",
  ].join("\n");
  writeFileSync(destination, existing);

  const result = savePermissionRule({
    version: NATIVE_CONTRACT_VERSION,
    operation: "rule_save",
    nonce: NATIVE_RULE_SAVE_NONCE,
    destination,
    scope: "user",
    tool: "read",
    rule,
  });
  const saved = parsePermissions(readFileSync(destination, "utf8")).read;
  console.log(
    JSON.stringify({
      destination,
      rule,
      allowed: result.allowed,
      rules: saved?.allow.length ?? 0,
    }),
  );

  assert.equal(result.ok, true);
  assert.equal(result.allowed, true);
  assert.deepEqual(saved?.allow, [rule]);
});

test("a failed save keeps the previous file and does not allow", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-wasm-rule-fail-"));
  const destination = join(root, "permissions.toml");
  const original = "[permissions]\n";
  const rule = { path: "^/work/notes\\.txt$" };
  writeFileSync(destination, original);
  chmodSync(root, 0o555);

  try {
    const result = savePermissionRule({
      version: NATIVE_CONTRACT_VERSION,
      operation: "rule_save",
      nonce: NATIVE_RULE_SAVE_NONCE,
      destination,
      scope: "user",
      tool: "read",
      rule,
    });
    console.log(
      JSON.stringify({
        destination,
        rule,
        ok: result.ok,
        allowed: result.allowed,
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.allowed, false);
    assert.equal(readFileSync(destination, "utf8"), original);
  } finally {
    chmodSync(root, 0o755);
  }
});

test("a subcommand save patches the approved rule once through WASM", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-wasm-subcommand-save-"));
  const destination = join(root, "permissions.toml");
  const expectedPath = join(root, "expected.toml");
  const rule = { command: "^git$" };
  writeFileSync(destination, "[permissions]\n");
  writeFileSync(expectedPath, "[permissions]\n");

  const expected = savePermissionRule({
    version: NATIVE_CONTRACT_VERSION,
    operation: "rule_save",
    nonce: NATIVE_RULE_SAVE_NONCE,
    destination: expectedPath,
    scope: "user",
    tool: "bash",
    rule,
  });
  const allowed = saveSubcommandAllowRules(destination, ["git"]);
  const actual = readFileSync(destination, "utf8");
  const saved = parsePermissions(actual).bash;
  console.log(
    JSON.stringify({
      destination,
      rule,
      allowed,
      rules: saved?.allow.length ?? 0,
    }),
  );

  assert.equal(expected.ok, true);
  assert.equal(allowed, true);
  assert.equal(actual, readFileSync(expectedPath, "utf8"));
  assert.deepEqual(saved, { allow: [rule], deny: [] });
});
