import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { resolveJjStatus, type JjRunner } from "./index.ts";

test("jj status uses the bookmark reported for the working-copy commit", () => {
  const runner: JjRunner = () => ({ status: 0, stdout: "favilo/footer\n" });

  assert.equal(resolveJjStatus("/repo", runner), "favilo/footer");
});

test("jj status falls back to the shortest stable change ID", () => {
  const runner: JjRunner = () => ({ status: 0, stdout: "qvnrwxyz\n" });

  assert.equal(resolveJjStatus("/repo", runner), "qvnrwxyz");
});

test("jj status is absent outside a jj repository", () => {
  const runner: JjRunner = () => ({ status: 1, stdout: "" });

  assert.equal(resolveJjStatus("/repo", runner), null);
});

test("jj status lookup does not snapshot the working copy", () => {
  let receivedArgs: readonly string[] = [];
  const runner: JjRunner = (_cwd, args) => {
    receivedArgs = args;
    return { status: 0, stdout: "e632de0b\n" };
  };

  resolveJjStatus("/repo", runner);

  assert.ok(receivedArgs.includes("--ignore-working-copy"));
});

test("jj status requests the stable change ID instead of the commit ID", () => {
  let receivedArgs: readonly string[] = [];
  const runner: JjRunner = (_cwd, args) => {
    receivedArgs = args;
    return { status: 0, stdout: "qvnrwxyz\n" };
  };

  resolveJjStatus("/repo", runner);

  const template = receivedArgs.at(-1);
  assert.match(template ?? "", /change_id\.shortest\(8\)/);
  assert.doesNotMatch(template ?? "", /commit_id/);
});
