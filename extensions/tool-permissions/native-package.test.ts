import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledNativePackagePath, resolveNativePackagePath } from "./native-package.ts";
import { parseWithNativeFallback } from "./native-parser-loader.ts";
import type { BashParseResult } from "./bash-parser.ts";

function withEnv(values: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("native package env var is a boolean enable switch for the bundled package", () => {
  assert.equal(resolveNativePackagePath({ PI_TOOL_PERMISSIONS_NATIVE_PACKAGE: "1" }), bundledNativePackagePath());
  assert.equal(resolveNativePackagePath({ PI_TOOL_PERMISSIONS_NATIVE_PACKAGE: "true" }), bundledNativePackagePath());
  assert.equal(resolveNativePackagePath({ PI_TOOL_PERMISSIONS_NATIVE_PACKAGE: "0" }), undefined);
  assert.equal(resolveNativePackagePath({ PI_TOOL_PERMISSIONS_NATIVE_PACKAGE: "/tmp/attacker/index.cjs" }), undefined);
});

test("bundled native loads ignore NAPI native library path overrides", () => {
  const directory = mkdtempSync(join(tmpdir(), "tool-permissions-native-napi-path-"));
  const attackerPath = join(directory, "attacker.cjs");
  const markerPath = join(directory, "attacker-loaded");
  writeFileSync(attackerPath, `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "loaded");
exports.probe = (request) => ({ version: 1, operation: request.operation, ok: true, nonce: request.nonce });
exports.parse = (request) => ({ version: 1, operation: "parse", ok: true, nonce: request.nonce, reason: "", detail: "", subcommands: [{ normalized: "attacker", command: "attacker", args: [], start: 0, end: 8 }] });
`);
  try {
    withEnv({ PI_TOOL_PERMISSIONS_NATIVE_PACKAGE: "1", NAPI_RS_NATIVE_LIBRARY_PATH: attackerPath }, () => {
      const fallback = (): BashParseResult => ({ ok: true, subcommands: [{ normalized: "fallback", command: "fallback", args: [], span: { start: 0, end: 8 } }] });
      const parsed = parseWithNativeFallback("anything", fallback);
      assert.notDeepEqual(parsed, { ok: true, subcommands: [{ normalized: "attacker", command: "attacker", args: [], span: { start: 0, end: 8 } }] });
      assert.equal(process.env.NAPI_RS_NATIVE_LIBRARY_PATH, attackerPath);
    });
    assert.equal(existsSync(markerPath), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("path-valued native package env vars are ignored by runtime adapters", () => {
  const directory = mkdtempSync(join(tmpdir(), "tool-permissions-native-env-path-"));
  const packagePath = join(directory, "index.cjs");
  writeFileSync(packagePath, `
exports.probe = (request) => ({ version: 1, operation: request.operation, ok: true, nonce: request.nonce });
exports.parse = (request) => ({ version: 1, operation: "parse", ok: true, nonce: request.nonce, reason: "", detail: "", subcommands: [{ normalized: "attacker", command: "attacker", args: [], start: 0, end: 8 }] });
`);
  try {
    withEnv({ PI_TOOL_PERMISSIONS_NATIVE_PACKAGE: packagePath }, () => {
      const fallback = (): BashParseResult => ({ ok: true, subcommands: [{ normalized: "fallback", command: "fallback", args: [], span: { start: 0, end: 8 } }] });
      assert.deepEqual(parseWithNativeFallback("anything", fallback), fallback());
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
