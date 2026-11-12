import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";

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

/** Patch one approved allow rule. The stub does not write, so the first test stays red. */
export function savePermissionRule(request: RuleSaveRequest): RuleSaveResult {
  return {
    version: NATIVE_CONTRACT_VERSION,
    operation: "rule_save",
    ok: false,
    nonce: request.nonce,
    allowed: false,
  };
}
