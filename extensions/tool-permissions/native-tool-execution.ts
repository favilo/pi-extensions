import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  requireNativePackage,
  resolveNativePackagePath,
} from "./native-package.ts";

export const NATIVE_TOOL_EXECUTION_NONCE =
  "tool-permissions-tool-execution" as const;

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
  /** Set when the native package cannot sequence the call. */
  unavailable?: boolean;
};

export type HostToolExecution = (
  toolName: string,
  inputJson: string,
) => Promise<string>;

type NativeToolExecution = {
  executeTool(
    request: SequencedToolRequest,
    execute: HostToolExecution,
  ): Promise<SequencedToolResult>;
};

function failedResult(request: SequencedToolRequest): SequencedToolResult {
  return {
    version: NATIVE_CONTRACT_VERSION,
    operation: "tool_execution",
    ok: false,
    nonce: request.nonce,
    decision: request.decision,
    executions: 0,
  };
}

function nativeUnavailable(request: SequencedToolRequest): SequencedToolResult {
  return { ...failedResult(request), unavailable: true };
}

function isSequencedResult(
  value: unknown,
  request: SequencedToolRequest,
): value is SequencedToolResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const valueJson = result.valueJson;
  const error = result.error;
  return (
    result.version === NATIVE_CONTRACT_VERSION &&
    result.operation === "tool_execution" &&
    typeof result.ok === "boolean" &&
    result.nonce === request.nonce &&
    typeof result.decision === "string" &&
    typeof result.executions === "number" &&
    Number.isInteger(result.executions) &&
    result.executions >= 0 &&
    (valueJson === undefined ||
      valueJson === null ||
      typeof valueJson === "string") &&
    (error === undefined || error === null || typeof error === "string")
  );
}

function normalize(result: SequencedToolResult): SequencedToolResult {
  const valueJson = result.valueJson ?? undefined;
  const error = result.error ?? undefined;
  return {
    version: result.version,
    operation: result.operation,
    ok: result.ok,
    nonce: result.nonce,
    decision: result.decision,
    executions: result.executions,
    ...(valueJson !== undefined ? { valueJson } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function loadNativeToolExecution(): NativeToolExecution | undefined {
  const packagePath = resolveNativePackagePath();
  if (!packagePath) return undefined;
  try {
    const native = requireNativePackage(
      packagePath,
    ) as Partial<NativeToolExecution>;
    return typeof native.executeTool === "function"
      ? (native as NativeToolExecution)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Ask WASM to run the host callback for this already validated decision. */
export async function executeSequencedTool(
  request: SequencedToolRequest,
  execute: HostToolExecution,
): Promise<SequencedToolResult> {
  if (
    request.version !== NATIVE_CONTRACT_VERSION ||
    request.operation !== "tool_execution"
  ) {
    return failedResult(request);
  }
  const native = loadNativeToolExecution();
  if (!native) return nativeUnavailable(request);
  try {
    const result = await native.executeTool(
      {
        version: request.version,
        operation: request.operation,
        nonce: request.nonce,
        decision: request.decision,
        toolName: request.toolName,
        inputJson: request.inputJson,
      },
      (toolName, inputJson) => Promise.resolve(execute(toolName, inputJson)),
    );
    return isSequencedResult(result, request)
      ? normalize(result)
      : failedResult(request);
  } catch {
    return failedResult(request);
  }
}
