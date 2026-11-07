import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const decisionPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../.specs/epics/e18-wasm-only-tool-permissions/e18s00-pi-oxidized-decision.md",
);

function field(text: string, name: string): string {
  const line = text.split("\n").find((entry) => entry.startsWith(`${name}:`));
  assert.ok(line, `missing ${name}`);
  return line.slice(name.length + 1).trim();
}

test("e18s00 rejects pi-oxidized-ext and records pi-api", () => {
  const text = readFileSync(decisionPath, "utf8");
  assert.equal(field(text, "decision"), "reject");
  assert.equal(field(text, "pi-oxidized"), "0.1.1");
  assert.equal(field(text, "pi-oxidized-ext"), "0.1.1");
  assert.match(field(text, "blocking constraint"), /ExtensionAPI/);
  assert.match(field(text, "blocking constraint"), /pi\.on/);
  assert.equal(field(text, "alternative"), "pi-api");
  assert.match(text, /extensions\/tool-permissions\/native\/crates\/pi-api/);
  assert.doesNotMatch(text, /^decision: adopt$/m);
});
