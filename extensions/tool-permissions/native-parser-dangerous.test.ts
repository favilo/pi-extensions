import "../test-support/forbid-fetch.ts";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

test("native parser rejects process-substitution redirects", (t) => {
  let parse: ((request: { version: number; operation: string; nonce: string; command: string }) => { ok: boolean; reason: string }) | undefined;
  try {
    parse = (createRequire(import.meta.url)("./native/generated/index.js") as { parse?: typeof parse }).parse;
  } catch {
    t.skip("native artifact is not built; run npm run build:native");
    return;
  }
  assert.ok(parse);
  for (const command of ["echo hi > >(cat)", "cat < <(jj status)"]) {
    const result = parse({ version: 1, operation: "parse", nonce: command, command });
    assert.equal(result.ok, false, command);
    assert.equal(result.reason, "unsupported_syntax", command);
  }
});

test("native parser extracts command substitutions nested inside double quotes", (t) => {
  // Known TypeScript-parser deficiency: unbash does not surface nested
  // CommandExpansion parts inside double-quoted words, so the TypeScript
  // fallback only sees the outer command. The native parser extracts the
  // nested subcommands with per-subcommand spans, so a deny rule on the
  // nested command still fires. Keep this native-only until the TypeScript
  // semantics are intentionally aligned; do not move it into the shared
  // parity corpus.
  let parse: ((request: { version: number; operation: string; nonce: string; command: string }) => {
    ok: boolean;
    subcommands?: Array<{ normalized: string; start: number; end: number }>;
  }) | undefined;
  try {
    parse = (createRequire(import.meta.url)("./native/generated/index.js") as { parse?: typeof parse }).parse;
  } catch {
    t.skip("native artifact is not built; run npm run build:native");
    return;
  }
  assert.ok(parse);
  for (const [command, expected] of [
    ["echo \"$(rm -rf /)\"", ["echo $(rm -rf /)", "rm -rf /"]],
    ["echo \"pre $(jj status) post\"", ["echo pre $(jj status) post", "jj status"]],
  ] as const) {
    const result = parse({ version: 1, operation: "parse", nonce: command, command });
    assert.equal(result.ok, true, command);
    assert.deepEqual(
      result.subcommands?.map((subcommand) => subcommand.normalized),
      [...expected],
      command,
    );
    const nested = result.subcommands?.[1];
    assert.ok(nested, command);
    assert.equal(command.slice(nested.start, nested.end), expected[1], command);
  }
});
