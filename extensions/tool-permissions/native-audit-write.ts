import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";

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

/**
 * Stub for the WASM audit writer.
 * It accepts the current record fields and reports that nothing was written.
 */
export function recordPermissionAudit(
  request: AuditWriteRequest,
): AuditWriteResult {
  return {
    version: NATIVE_CONTRACT_VERSION,
    operation: "audit_write",
    ok: false,
    nonce: request.nonce,
    decision: request.decision,
    records: 0,
  };
}
