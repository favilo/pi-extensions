import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";

export const NATIVE_TOOL_EXECUTION_NONCE =
  "tool-permissions-tool-execution" as const;

export type SequencedToolDecision = "allow" | "deny" | "cancel";

export type SequencedToolRequest = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "tool_execution";
  nonce: string;
  decision: string;
  toolName: string;
  inputJson: string;
};

export type SequencedToolResult = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "tool_execution";
  ok: boolean;
  nonce: string;
  decision: string;
  executions: number;
  valueJson?: string;
  error?: string;
};

export type HostToolExecution = (
  toolName: string,
  inputJson: string,
) => Promise<string>;

/** Stub. WASM does not yet sequence the host callback. */
export async function executeSequencedTool(
  request: SequencedToolRequest,
  _execute: HostToolExecution,
): Promise<SequencedToolResult> {
  return {
    version: NATIVE_CONTRACT_VERSION,
    operation: "tool_execution",
    ok: false,
    nonce: request.nonce,
    decision: request.decision,
    executions: 0,
  };
}
