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
allow = [
  { command = '^jj' },
  { "metadata.mode" = '^safe$', enabled = '^true$' },
  { tags = '\\[\\"trusted\\"\\]' },
  {},
]
deny = [{ command = '^rm' }]

[permissions.mcp__example_provider__search]
allow = [
  { query = '^public', "filters.created_date_range.start_date" = '^2025-' },
  { ids = '\\[\\"one\\",\\"two\\"\\]' },
]
deny = [{ query = 'secret' }]
`;
  const permissions = parsePermissionsTypescript(source);
  for (const { tool, input } of [
    { tool: "bash", input: { command: "jj status" } },
    { tool: "bash", input: { command: "rm -rf /" } },
    { tool: "bash", input: { command: "echo hi" } },
    { tool: "bash", input: { metadata: { mode: "safe" }, enabled: true } },
    { tool: "bash", input: { tags: ["trusted"] } },
    { tool: "mcp__example_provider__search", input: { query: "public roadmap", filters: { created_date_range: { start_date: "2025-01-01" } } } },
    { tool: "mcp__example_provider__search", input: { query: "public roadmap", filters: { created_date_range: { start_date: "2024-01-01" } } } },
    { tool: "mcp__example_provider__search", input: { query: "secret roadmap" } },
    { tool: "mcp__example_provider__search", input: { page_size: 1 } },
    { tool: "mcp__example_provider__search", input: { ids: ["one", "two"] } },
    { tool: "unknown_tool", input: { query: "public roadmap" } },
  ] as const) {
    const native = evaluate({ version: 1, operation: "evaluate", nonce: "parity", source, tool, inputJson: JSON.stringify(input) });
    assert.equal(native.ok, true);
    assert.equal(native.decision, permissionDecision(permissions[tool], input), `${tool} ${JSON.stringify(input)}`);
  }
});
