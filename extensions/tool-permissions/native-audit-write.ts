import { writeAuditLine } from "./audit.ts";
import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  requireNativePackage,
  resolveNativePackagePath,
} from "./native-package.ts";

export const NATIVE_AUDIT_WRITE_NONCE = "tool-permissions-audit-write" as const;

export type AuditWriteRequest = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "audit_write";
  nonce: string;
  homeDir: string;
  now: string;
  tool: string;
  decision: string;
  cwd: string;
  path?: string;
  command?: string;
  reason?: string;
};

export type AuditWriteResult = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "audit_write";
  ok: boolean;
  nonce: string;
  decision: string;
  records: number;
};

type NativeAuditRequest = {
  version: number;
  operation: string;
  nonce: string;
  homeDir: string;
  now: string;
  tool: string;
  decision: string;
  cwd: string;
  path?: string;
  command?: string;
  reason?: string;
};

type NativeAuditWrite = {
  writeAudit(
    request: NativeAuditRequest,
    append: (line: string) => boolean,
  ): AuditWriteResult;
};

function isAuditWriteResult(
  value: unknown,
  request: AuditWriteRequest,
): value is AuditWriteResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    result.version === NATIVE_CONTRACT_VERSION &&
    result.operation === "audit_write" &&
    typeof result.ok === "boolean" &&
    result.nonce === request.nonce &&
    typeof result.decision === "string" &&
    result.decision.length > 0 &&
    typeof result.records === "number" &&
    Number.isInteger(result.records) &&
    result.records >= 0 &&
    (result.ok === false || result.records === 1)
  );
}

/** Ask WASM to append one audit record through the current log destination. */
export function recordPermissionAudit(
  request: AuditWriteRequest,
): AuditWriteResult {
  const failed: AuditWriteResult = {
    version: NATIVE_CONTRACT_VERSION,
    operation: "audit_write",
    ok: false,
    nonce: request.nonce,
    decision: request.decision,
    records: 0,
  };
  if (
    request.version !== NATIVE_CONTRACT_VERSION ||
    request.operation !== "audit_write"
  ) {
    return failed;
  }
  const packagePath = resolveNativePackagePath();
  if (!packagePath) return failed;
  let native: Partial<NativeAuditWrite>;
  try {
    native = requireNativePackage(packagePath) as Partial<NativeAuditWrite>;
  } catch {
    return failed;
  }
  if (typeof native.writeAudit !== "function") return failed;
  try {
    const result = native.writeAudit(
      {
        version: request.version,
        operation: request.operation,
        nonce: request.nonce,
        homeDir: request.homeDir,
        now: request.now,
        tool: request.tool,
        decision: request.decision,
        cwd: request.cwd,
        path: request.path,
        command: request.command,
        reason: request.reason,
      },
      (line) =>
        writeAuditLine(
          {
            homeDir: request.homeDir,
            now: () => new Date(request.now),
          },
          line,
        ),
    );
    return isAuditWriteResult(result, request) ? result : failed;
  } catch {
    return failed;
  }
}
