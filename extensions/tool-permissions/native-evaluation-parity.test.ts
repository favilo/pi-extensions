import "../test-support/forbid-fetch.ts";
import { createRequire } from "node:module";
import { test } from "node:test";
import assert from "node:assert/strict";
import { permissionDecision, parsePermissionsTypescript } from "./config.ts";

test("native policy evaluation matches TypeScript decisions", (t) => {
  let evaluate: ((request: unknown) => { ok: boolean; decision: string }) | undefined;
  try {
    evaluate = (createRequire(import.meta.url)("./native/index.js") as { evaluatePolicy?: typeof evaluate }).evaluatePolicy;
  } catch {
    t.skip("native artifact is not built; run npm run build:native");
    return;
  }
  assert.ok(evaluate);
  const source = `[permissions.bash]
allow = [{ command = '^jj' }, { "metadata.mode" = '^safe$', enabled = '^true$' }, { tags = '\\[\\"trusted\\"\\]' }]
deny = [{ command = '^rm' }]
`;
  const permissions = parsePermissionsTypescript(source);
  for (const input of [
    { command: "jj status" },
    { command: "rm -rf /" },
    { command: "echo hi" },
    { metadata: { mode: "safe" }, enabled: true },
    { tags: ["trusted"] },
  ]) {
    const native = evaluate({ version: 1, operation: "evaluate", nonce: "parity", source, tool: "bash", inputJson: JSON.stringify(input) });
    assert.equal(native.ok, true);
    assert.equal(native.decision, permissionDecision(permissions.bash, input), input.command);
  }
});
