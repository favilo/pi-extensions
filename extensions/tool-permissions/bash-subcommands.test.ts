import "../test-support/forbid-fetch.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify as stringifyToml } from "smol-toml";
import { evaluateBashSubcommands } from "./bash-subcommands.ts";

function createPolicyDir(policyObj: unknown): { tmpDir: string; userPermissionsPath: string } {
  const tmpDir = mkdtempSync(join(tmpdir(), "bash-subcommands-test-"));
  const configDir = join(tmpDir, ".config", "pi");
  mkdirSync(configDir, { recursive: true });
  const userPermissionsPath = join(configDir, "permissions.toml");
  
  writeFileSync(userPermissionsPath, stringifyToml({ permissions: policyObj as any }));
  return { tmpDir, userPermissionsPath };
}

test("evaluates simple command against allow rules", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: {
      allow: [{ command: "^jj status$" }],
      deny: [],
    },
  });
  try {
    const result = evaluateBashSubcommands("jj status", tmpDir, { userPermissionsPath });
    assert.equal(result.decision, "allow");
    assert.equal(result.subcommands.length, 1);
    assert.equal(result.subcommands[0].normalized, "jj status");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("evaluates compound list commands (&&, ||, ;) when all subcommands are allowed", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: {
      allow: [{ command: "^jj status$" }, { command: "^jj diff" }],
      deny: [],
    },
  });
  try {
    const result = evaluateBashSubcommands("jj status && jj diff --stat", tmpDir, { userPermissionsPath });
    assert.equal(result.decision, "allow");
    assert.equal(result.subcommands.length, 2);
    assert.equal(result.subcommands[0].normalized, "jj status");
    assert.equal(result.subcommands[1].normalized, "jj diff --stat");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("evaluates pipeline commands when all subcommands are allowed", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: {
      allow: [{ command: "^jj log$" }, { command: "^grep feat$" }],
      deny: [],
    },
  });
  try {
    const result = evaluateBashSubcommands("jj log | grep feat", tmpDir, { userPermissionsPath });
    assert.equal(result.decision, "allow");
    assert.equal(result.subcommands.length, 2);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("evaluates explicit bash -c payloads recursively", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: {
      allow: [{ command: "^jj status$" }, { command: "^jj diff" }],
      deny: [],
    },
  });
  try {
    const result = evaluateBashSubcommands("bash -c 'jj status; jj diff --summary'", tmpDir, { userPermissionsPath });
    assert.equal(result.decision, "allow");
    assert.equal(result.subcommands.length, 2);
    assert.equal(result.subcommands[0].normalized, "jj status");
    assert.equal(result.subcommands[1].normalized, "jj diff --summary");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("denies entire command atomically if one subcommand matches a deny rule", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: {
      allow: [{ command: "^jj status$" }],
      deny: [{ command: "^rm " }],
    },
  });
  try {
    const result = evaluateBashSubcommands("jj status && rm -rf /", tmpDir, { userPermissionsPath });
    assert.equal(result.decision, "deny");
    assert.ok(result.deniedSubcommand);
    assert.equal(result.deniedSubcommand?.normalized, "rm -rf /");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("defaults to ask if any subcommand has no matching allow or deny rule", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: {
      allow: [{ command: "^jj status$" }],
      deny: [],
    },
  });
  try {
    const result = evaluateBashSubcommands("jj status && cargo check", tmpDir, { userPermissionsPath });
    assert.equal(result.decision, "ask");
    assert.equal(result.subcommands.length, 2);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("fails closed (deny) when command contains unsupported syntax or parse error", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: {
      allow: [{ command: ".*" }],
      deny: [],
    },
  });
  try {
    const result = evaluateBashSubcommands("jj status && $(whoami)", tmpDir, { userPermissionsPath });
    assert.equal(result.decision, "deny");
    assert.match(result.reason ?? "", /unsupported/i);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("returns detailed reason identifying denied subcommand for agent error reporting", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: {
      allow: [{ command: "^jj status$" }],
      deny: [{ command: "^rm " }],
    },
  });
  try {
    const result = evaluateBashSubcommands("jj status && rm -rf /tmp/test", tmpDir, { userPermissionsPath });
    assert.equal(result.decision, "deny");
    assert.equal(result.deniedSubcommand?.normalized, "rm -rf /tmp/test");
    assert.match(result.reason ?? "", /subcommand "rm -rf \/tmp\/test" matches a configured deny rule/);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("audits each evaluated subcommand when audit option is supplied", () => {
  const { tmpDir, userPermissionsPath } = createPolicyDir({
    bash: {
      allow: [{ command: "^jj status$" }],
      deny: [{ command: "^rm " }],
    },
  });
  const audited: Array<Record<string, unknown>> = [];
  try {
    const result = evaluateBashSubcommands("jj status && rm -rf /", tmpDir, {
      userPermissionsPath,
      audit: (entry) => audited.push(entry),
    });
    assert.equal(result.decision, "deny");
    assert.ok(audited.length >= 2, "must audit subcommands and aggregate decision");
    const subAudit = audited.find((e) => e.subcommand === "rm -rf /");
    assert.ok(subAudit);
    assert.equal(subAudit.decision, "deny");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
