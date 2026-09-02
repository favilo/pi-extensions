import "../test-support/forbid-fetch.ts";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";

test("native parser rejects process-substitution redirects", (t) => {
  let parse: ((request: { version: number; operation: string; nonce: string; command: string }) => { ok: boolean; reason: string }) | undefined;
  try {
    parse = (createRequire(import.meta.url)("./native/index.js") as { parse?: typeof parse }).parse;
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
