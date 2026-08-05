import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { patch as patchToml, TomlFormat } from "@decimalturn/toml-patch";
import { parse as parseToml } from "smol-toml";

export type PermissionRule = Record<string, string>;

export type ToolPermission = {
  allow: PermissionRule[];
  deny: PermissionRule[];
};

export type Permissions = Record<string, ToolPermission>;

const READ_TOOLS = new Set(["read", "ls", "grep", "find"]);

export function permissionKeyForTool(toolName: string): string {
  if (READ_TOOLS.has(toolName)) return "read";
  if (toolName === "write" || toolName === "edit") return "write";
  return toolName;
}

const CONFIG_HEADER = [
  "# Tool permissions: deny rules take precedence over allow rules.",
  "# read covers read, ls, grep, and find. write covers write and edit.",
  "# Rule keys are dot paths into tool arguments; values are JavaScript RegExp patterns.",
  "# Fields in one rule are ANDed. Rules in a list are ORed. An empty rule matches every call.",
  "",
].join("\n");

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseRules(value: unknown, field: string): PermissionRule[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((item, index) => {
    const rule = object(item);
    if (!rule) throw new Error(`${field}[${index}] must be a table`);
    for (const [path, pattern] of Object.entries(rule)) {
      if (!path || typeof pattern !== "string") throw new Error(`${field}[${index}] must contain string patterns`);
      new RegExp(pattern);
    }
    return rule as PermissionRule;
  });
}

export function parsePermissions(source: string): Permissions {
  const root = object(parseToml(source));
  const table = object(root?.permissions);
  if (!table) return {};

  return Object.fromEntries(Object.entries(table).map(([toolName, value]) => {
    const permission = object(value);
    if (!permission) throw new Error(`permissions.${toolName} must be a table`);
    return [toolName, {
      allow: parseRules(permission.allow, `permissions.${toolName}.allow`),
      deny: parseRules(permission.deny, `permissions.${toolName}.deny`),
    }];
  }));
}

export function loadPermissions(path: string): Permissions {
  try {
    return parsePermissions(readFileSync(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

function fieldValue(input: unknown, path: string): unknown {
  let current = input;
  for (const part of path.split(".")) {
    const record = object(current);
    if (!record || !(part in record)) return undefined;
    current = record[part];
  }
  return current;
}

function patternValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function matchesPermissionRule(rule: PermissionRule, input: unknown): boolean {
  return Object.entries(rule).every(([path, pattern]) => {
    const value = fieldValue(input, path);
    return value !== undefined && new RegExp(pattern).test(patternValue(value));
  });
}

export function permissionDecision(permission: ToolPermission | undefined, input: unknown): "allow" | "deny" | "ask" {
  if (!permission) return "ask";
  if (permission.deny.some((rule) => matchesPermissionRule(rule, input))) return "deny";
  if (permission.allow.some((rule) => matchesPermissionRule(rule, input))) return "allow";
  return "ask";
}

export function saveAllowedRule(path: string, toolName: string, rule: PermissionRule): void {
  let source = "";
  try {
    source = readFileSync(path, "utf8");
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (!source) source = `${CONFIG_HEADER}[permissions]\n`;
  const root = object(parseToml(source)) ?? {};
  const permissions = parsePermissions(source);
  const permission = permissions[toolName] ?? { allow: [], deny: [] };
  if (permission.allow.some((candidate) => JSON.stringify(candidate) === JSON.stringify(rule))) return;
  permission.allow.push(rule);
  permissions[toolName] = permission;

  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  root.permissions = permissions;
  const format = TomlFormat.autoDetectFormat(source);
  format.inlineTableStart = 2;
  writeFileSync(temporaryPath, patchToml(source, root, format), "utf8");
  renameSync(temporaryPath, path);
}

export function parsePermissionRuleJson(source: string): PermissionRule | undefined {
  try {
    const parsed = object(JSON.parse(source));
    if (!parsed) return undefined;
    for (const value of Object.values(parsed)) {
      if (typeof value !== "string") return undefined;
      new RegExp(value);
    }
    return parsed as PermissionRule;
  } catch {
    return undefined;
  }
}
