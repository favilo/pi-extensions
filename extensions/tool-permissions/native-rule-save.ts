import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  requireNativePackage,
  resolveNativePackagePath,
} from "./native-package.ts";

export const NATIVE_RULE_SAVE_NONCE = "tool-permissions-rule-save" as const;

export type RuleSaveRequest = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "rule_save";
  nonce: string;
  destination: string;
  scope: "user" | "project";
  tool: string;
  rule: Record<string, string>;
};

export type RuleSaveResult = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "rule_save";
  ok: boolean;
  nonce: string;
  allowed: boolean;
};

type NativeRuleSaveRequest = {
  version: number;
  operation: string;
  nonce: string;
  source: string;
  tool: string;
  ruleJson: string;
};

type NativeRuleSaveResult = RuleSaveResult & {
  contents: string;
};

type NativeRuleSave = {
  saveRule(request: NativeRuleSaveRequest): NativeRuleSaveResult;
};

function failedResult(request: RuleSaveRequest): RuleSaveResult {
  return {
    version: NATIVE_CONTRACT_VERSION,
    operation: "rule_save",
    ok: false,
    nonce: request.nonce,
    allowed: false,
  };
}

function readSource(destination: string): string | undefined {
  try {
    return readFileSync(destination, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return "";
    }
    return undefined;
  }
}

function isSavedContents(
  value: unknown,
  request: RuleSaveRequest,
): value is NativeRuleSaveResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    result.version === NATIVE_CONTRACT_VERSION &&
    result.operation === "rule_save" &&
    result.ok === true &&
    result.allowed === true &&
    result.nonce === request.nonce &&
    typeof result.contents === "string" &&
    result.contents.length > 0
  );
}

function patchedContents(
  request: RuleSaveRequest,
  source: string,
): string | undefined {
  const packagePath = resolveNativePackagePath();
  if (!packagePath) return undefined;
  let native: Partial<NativeRuleSave>;
  try {
    native = requireNativePackage(packagePath) as Partial<NativeRuleSave>;
  } catch {
    return undefined;
  }
  if (typeof native.saveRule !== "function") return undefined;
  try {
    const result = native.saveRule({
      version: request.version,
      operation: request.operation,
      nonce: request.nonce,
      source,
      tool: request.tool,
      ruleJson: JSON.stringify(request.rule),
    });
    return isSavedContents(result, request) ? result.contents : undefined;
  } catch {
    return undefined;
  }
}

function replaceFile(destination: string, contents: string): boolean {
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(temporary, contents, "utf8");
    renameSync(temporary, destination);
    return true;
  } catch {
    return false;
  }
}

/** Ask WASM for the patched permissions file, then replace the destination once. */
export function savePermissionRule(request: RuleSaveRequest): RuleSaveResult {
  const failed = failedResult(request);
  if (
    request.version !== NATIVE_CONTRACT_VERSION ||
    request.operation !== "rule_save"
  ) {
    return failed;
  }
  const source = readSource(request.destination);
  if (source === undefined) return failed;
  const contents = patchedContents(request, source);
  if (contents === undefined || !replaceFile(request.destination, contents)) {
    return failed;
  }
  return { ...failed, ok: true, allowed: true };
}
