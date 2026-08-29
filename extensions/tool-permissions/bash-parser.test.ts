import "../test-support/forbid-fetch.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBashCommand } from "./bash-parser.ts";

test("parses a single simple command into one subcommand", () => {
  const result = parseBashCommand("jj status");

  assert.equal(result.ok, true);
  if (!result.ok) return; // type narrowing

  assert.equal(result.subcommands.length, 1);

  const sub = result.subcommands[0];
  assert.equal(sub.command, "jj");
  assert.deepEqual(sub.args, ["status"]);
  assert.equal(sub.normalized, "jj status");
  assert.deepEqual(sub.span, { start: 0, end: 9 });
});
