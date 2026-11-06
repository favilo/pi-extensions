import "../test-support/forbid-fetch.ts";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePermissionsTypescript } from "./config.ts";

test("native TOML policy parsing matches the TypeScript policy shape", (t) => {
  let parsePolicy: ((request: unknown) => unknown) | undefined;
  try {
    parsePolicy = (createRequire(import.meta.url)("./native/generated/index.js") as { parsePolicy?: typeof parsePolicy }).parsePolicy;
  } catch {
    t.skip("native artifact is not built; run npm run build:native");
    return;
  }
  assert.ok(parsePolicy);
  const source = "[permissions.read]\nallow = [{ path = '^/tmp', line = '^[0-9]+$' }]\ndeny = [{ path = '^/tmp/private' }]\n";
  const native = parsePolicy({ version: 1, operation: "policy", nonce: "parity", source }) as { ok: boolean; permissions: unknown };
  assert.equal(native.ok, true);
  assert.deepEqual(native.permissions, parsePermissionsTypescript(source));
});

test("native TOML policy parsing handles array-of-table rule formatting", (t) => {
  let parsePolicy: ((request: unknown) => unknown) | undefined;
  try {
    parsePolicy = (createRequire(import.meta.url)("./native/generated/index.js") as { parsePolicy?: typeof parsePolicy }).parsePolicy;
  } catch {
    t.skip("native artifact is not built; run npm run build:native");
    return;
  }
  assert.ok(parsePolicy);
  const source = [
    "[permissions.read]",
    "[[permissions.read.allow]]",
    "path = '^/tmp'",
    "line = '^[0-9]+$'",
    "",
    "[[permissions.read.deny]]",
    "path = '^/tmp/private'",
    "",
  ].join("\n");
  const native = parsePolicy({ version: 1, operation: "policy", nonce: "array-table", source }) as { ok: boolean; permissions: unknown };
  assert.equal(native.ok, true);
  assert.deepEqual(native.permissions, parsePermissionsTypescript(source));
});
