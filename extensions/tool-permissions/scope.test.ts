import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";
import { type Permissions } from "./config.ts";
import { discoverProjectPolicyPaths, resolveCurrentProjectPolicyPath, resolveScopedPermissionDecision, type ScopeFileSystem, type TrustResolver } from "./scope.ts";

function policy(permissions: Permissions): string {
  return stringifyToml({ permissions });
}

test("discovers only the current project outside a repository", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-scope-"));
  const cwd = join(root, "child");
  mkdirSync(cwd, { recursive: true });
  assert.deepEqual(discoverProjectPolicyPaths(cwd, ".pi", {
    existsSync: () => false,
    realpathSync: (path) => path,
    loadPermissions: () => ({}),
  }), [join(cwd, ".pi", "permissions.toml")]);
});

test("stops at the nearest Git or Jujutsu boundary", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-scope-"));
  const repo = join(root, "repo");
  const cwd = join(repo, "nested");
  mkdirSync(join(repo, ".jj"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  const paths = discoverProjectPolicyPaths(cwd, ".pi", {
    existsSync: (path) => path === join(repo, ".jj"),
    realpathSync: (path) => path,
    loadPermissions: () => ({}),
  });
  assert.deepEqual(paths, [join(cwd, ".pi", "permissions.toml"), join(repo, ".pi", "permissions.toml")]);
});

test("resolves the current directory policy path only under persisted trust", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-scope-"));
  const cwd = join(root, "repo", "child");
  mkdirSync(cwd, { recursive: true });
  const fs: ScopeFileSystem = {
    existsSync: (path) => path === join(root, "repo", ".git"),
    realpathSync: (path) => path,
    loadPermissions: () => ({}),
  };
  assert.equal(resolveCurrentProjectPolicyPath({ cwd, trustResolver: () => null, fileSystem: fs }), undefined);
  assert.equal(resolveCurrentProjectPolicyPath({
    cwd,
    trustResolver: () => ({ path: join(root, "repo"), decision: true }),
    fileSystem: fs,
  }), join(cwd, ".pi", "permissions.toml"));
});

test("nearest matching trusted project policy overrides parent and user policy", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-scope-"));
  const repo = join(root, "project");
  const cwd = join(repo, "child");
  mkdirSync(join(repo, ".git"), { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(repo, ".pi"), { recursive: true });
  writeFileSync(join(repo, ".pi", "permissions.toml"), policy({ bash: { allow: [{ command: "^pwd$" }], deny: [] } }));
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(join(cwd, ".pi", "permissions.toml"), policy({ bash: { allow: [], deny: [{ command: "^pwd$" }] } }));
  assert.equal(resolveScopedPermissionDecision({
    cwd,
    toolName: "bash",
    input: { command: "pwd" },
    userPermissionsPath: join(root, "user.toml"),
    trustResolver: () => ({ path: repo, decision: true }),
  }).decision, "deny");
});

test("trust failure preserves user policy fallback", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-scope-"));
  const cwd = join(root, "cwd");
  mkdirSync(cwd, { recursive: true });
  const user = join(root, "user.toml");
  writeFileSync(user, policy({ bash: { allow: [{ command: "^pwd$" }], deny: [] } }));
  assert.deepEqual(resolveScopedPermissionDecision({
    cwd,
    toolName: "bash",
    input: { command: "pwd" },
    userPermissionsPath: user,
    trustResolver: () => { throw new Error("bad trust store"); },
  }), { decision: "allow", source: "user", path: user });
});

test("rejects a project policy that resolves outside the trusted path", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-scope-"));
  const cwd = join(root, "repo");
  const policyPath = join(cwd, ".pi", "permissions.toml");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  writeFileSync(policyPath, policy({ bash: { allow: [{}], deny: [] } }));
  const outside = join(root, "outside", "permissions.toml");
  const fs = {
    existsSync: (path: string) => path === join(cwd, ".git") || path === policyPath,
    realpathSync: (path: string) => path === policyPath ? outside : path,
    loadPermissions: () => ({ bash: { allow: [{}], deny: [] } }),
  };
  assert.equal(resolveScopedPermissionDecision({
    cwd,
    toolName: "bash",
    input: { command: "pwd" },
    userPermissionsPath: join(root, "user.toml"),
    trustResolver: () => ({ path: cwd, decision: true }),
    fileSystem: fs,
  }).source, "none");
});

test("malformed eligible project policy returns a diagnostic instead of falling through", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-permission-scope-"));
  const cwd = join(root, "repo");
  mkdirSync(join(cwd, ".git"), { recursive: true });
  mkdirSync(join(cwd, ".pi"), { recursive: true });
  const project = join(cwd, ".pi", "permissions.toml");
  writeFileSync(project, "[permissions.bash\n");
  assert.match(resolveScopedPermissionDecision({
    cwd,
    toolName: "bash",
    input: { command: "pwd" },
    userPermissionsPath: join(root, "user.toml"),
    trustResolver: () => ({ path: cwd, decision: true }),
  }).diagnostic ?? "", /project permission policy/i);
});
