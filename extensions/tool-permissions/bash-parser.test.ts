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

test("parses && compound into two subcommands", () => {
  const result = parseBashCommand("jj status && jj diff --stat");

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.subcommands.length, 2);

  const [first, second] = result.subcommands;
  assert.equal(first.command, "jj");
  assert.deepEqual(first.args, ["status"]);
  assert.equal(first.normalized, "jj status");

  assert.equal(second.command, "jj");
  assert.deepEqual(second.args, ["diff", "--stat"]);
  assert.equal(second.normalized, "jj diff --stat");
});

test("parses || compound into two subcommands", () => {
  const result = parseBashCommand("cmd1 || cmd2");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subcommands.length, 2);
  assert.equal(result.subcommands[0].command, "cmd1");
  assert.equal(result.subcommands[1].command, "cmd2");
});

test("parses ; sequential into two subcommands", () => {
  const result = parseBashCommand("cmd1; cmd2");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subcommands.length, 2);
  assert.equal(result.subcommands[0].command, "cmd1");
  assert.equal(result.subcommands[1].command, "cmd2");
});

test("parses a pipeline into two subcommands", () => {
  const result = parseBashCommand("cmd1 | cmd2");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subcommands.length, 2);
  assert.equal(result.subcommands[0].command, "cmd1");
  assert.equal(result.subcommands[1].command, "cmd2");
});

test("parses bash -c payload into subcommands", () => {
  const result = parseBashCommand("bash -c 'jj status; jj diff --summary'");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subcommands.length, 2);
  assert.equal(result.subcommands[0].command, "jj");
  assert.deepEqual(result.subcommands[0].args, ["status"]);
  assert.equal(result.subcommands[1].command, "jj");
  assert.deepEqual(result.subcommands[1].args, ["diff", "--summary"]);
});

test("preserves quoted argument boundaries", () => {
  const result = parseBashCommand('echo "hello world"');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subcommands.length, 1);
  assert.equal(result.subcommands[0].command, "echo");
  assert.deepEqual(result.subcommands[0].args, ["hello world"]);
});

test("strips redirects and keeps the subcommand", () => {
  const result = parseBashCommand("jj log > output.txt");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subcommands.length, 1);
  assert.equal(result.subcommands[0].command, "jj");
  assert.deepEqual(result.subcommands[0].args, ["log"]);
});

test("fails closed on command substitution", () => {
  const result = parseBashCommand("echo $(whoami)");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unsupported_syntax");
});

test("fails closed on for loop", () => {
  const result = parseBashCommand("for f in *.ts; do echo $f; done");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unsupported_syntax");
});

test("fails closed on function definition", () => {
  const result = parseBashCommand("greet() { echo hi; }");
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "unsupported_syntax");
});

test("source spans point to exact positions in the original text", () => {
  const cmd = "jj status && jj diff --stat";
  const result = parseBashCommand(cmd);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.subcommands.length, 2);

  // First subcommand: "jj status" starts at 0
  const first = result.subcommands[0];
  assert.equal(cmd.slice(first.span.start, first.span.end), "jj status");

  // Second subcommand: "jj diff --stat" starts after "&& "
  const second = result.subcommands[1];
  assert.equal(cmd.slice(second.span.start, second.span.end), "jj diff --stat");
});
