import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("README.md documents the /usage command and provider usage visibility", () => {
  const readme = readFileSync("README.md", "utf8");
  assert.match(readme, /`usage`/);
  assert.match(readme, /provider/i);
});
