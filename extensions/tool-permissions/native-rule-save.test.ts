import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parsePermissions } from "./config.ts";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  NATIVE_RULE_SAVE_NONCE,
  savePermissionRule,
} from "./native-rule-save.ts";
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
