import { existsSync, realpathSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { CONFIG_DIR_NAME, getAgentDir, ProjectTrustStore } from "@earendil-works/pi-coding-agent";
import { loadPermissions, permissionDecision, permissionKeyForTool, type Permissions } from "./config.ts";

export type TrustEntry = { path: string; decision: boolean };
export type TrustResolver = (cwd: string) => TrustEntry | null;
export type ScopeFileSystem = {
  existsSync: (path: string) => boolean;
  realpathSync: (path: string) => string;
  loadPermissions: (path: string) => Permissions;
};

export type ScopedPermissionDecision = {
  decision: "allow" | "deny" | "prompt";
  source: "project" | "user" | "none";
  path?: string;
  diagnostic?: string;
};

const defaultFileSystem: ScopeFileSystem = { existsSync, realpathSync, loadPermissions };

function canonical(path: string, fs: ScopeFileSystem): string {
  try {
    return fs.realpathSync(resolve(path));
  } catch {
    return resolve(path);
  }
}

function isInside(path: string, directory: string): boolean {
  const rel = relative(directory, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !/^[A-Za-z]:/.test(rel));
}

function ancestors(cwd: string): string[] {
  const result: string[] = [];
  let current = cwd;
  while (true) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) return result;
    current = parent;
  }
}

export function discoverProjectPolicyPaths(
  cwd: string,
  configDirName = CONFIG_DIR_NAME,
  fileSystem: ScopeFileSystem = defaultFileSystem,
): string[] {
  const current = canonical(cwd, fileSystem);
  const directories = ancestors(current);
  const boundary = directories.find((directory) =>
    fileSystem.existsSync(join(directory, ".git")) || fileSystem.existsSync(join(directory, ".jj")),
  );
  const eligible = boundary ? directories.slice(0, directories.indexOf(boundary) + 1) : [current];
  return eligible.map((directory) => join(directory, configDirName, "permissions.toml"));
}

export function resolveTrustEligibility(cwd: string, trustResolver: TrustResolver): TrustEntry | null {
  try {
    const entry = trustResolver(cwd);
    if (!entry || !entry.decision) return null;
    return entry;
  } catch {
    return null;
  }
}

export function createPersistedTrustResolver(agentDir = getAgentDir()): TrustResolver {
  const store = new ProjectTrustStore(agentDir);
  return (cwd) => {
    const entry = store.getEntry(cwd);
    return entry ? { path: entry.path, decision: entry.decision } : null;
  };
}

export function resolveCurrentProjectPolicyPath(options: {
  cwd: string;
  trustResolver?: TrustResolver;
  configDirName?: string;
  fileSystem?: ScopeFileSystem;
}): string | undefined {
  const fs = options.fileSystem ?? defaultFileSystem;
  const current = canonical(options.cwd, fs);
  const trust = resolveTrustEligibility(current, options.trustResolver ?? createPersistedTrustResolver());
  if (!trust) return undefined;
  const trustedPath = canonical(trust.path, fs);
  const projectPath = discoverProjectPolicyPaths(current, options.configDirName, fs)[0];
  return isInside(canonical(projectPath, fs), trustedPath) ? projectPath : undefined;
}

export function resolveScopedPermissionDecision(options: {
  cwd: string;
  toolName: string;
  input: unknown;
  userPermissionsPath: string;
  trustResolver?: TrustResolver;
  configDirName?: string;
  fileSystem?: ScopeFileSystem;
}): ScopedPermissionDecision {
  const fs = options.fileSystem ?? defaultFileSystem;
  const current = canonical(options.cwd, fs);
  const trust = resolveTrustEligibility(current, options.trustResolver ?? createPersistedTrustResolver());
  if (trust) {
    const trustedPath = canonical(trust.path, fs);
    for (const policyPath of discoverProjectPolicyPaths(current, options.configDirName, fs)) {
      if (!fs.existsSync(policyPath)) continue;
      const canonicalPolicyPath = canonical(policyPath, fs);
      if (!isInside(canonicalPolicyPath, trustedPath)) continue;
      try {
        const decision = permissionDecision(
          fs.loadPermissions(canonicalPolicyPath)[permissionKeyForTool(options.toolName)],
          options.input,
        );
        if (decision !== "prompt") return { decision, source: "project", path: canonicalPolicyPath };
      } catch (error) {
        return {
          decision: "prompt",
          source: "project",
          path: canonicalPolicyPath,
          diagnostic: `Project permission policy could not be read: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
  }

  try {
    const decision = permissionDecision(
      loadPermissions(options.userPermissionsPath)[permissionKeyForTool(options.toolName)],
      options.input,
    );
    return { decision, source: decision === "prompt" ? "none" : "user", path: options.userPermissionsPath };
  } catch (error) {
    return {
      decision: "prompt",
      source: "user",
      path: options.userPermissionsPath,
      diagnostic: `User permission policy could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export function defaultScopeFileSystem(): ScopeFileSystem {
  return defaultFileSystem;
}
