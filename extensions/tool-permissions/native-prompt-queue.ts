import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";
import {
  requireNativePackage,
  resolveNativePackagePath,
} from "./native-package.ts";

export const NATIVE_PROMPT_QUEUE_NONCE =
  "tool-permissions-prompt-queue" as const;

export const PromptQueueDecision = Object.freeze({
  Allow: "allow",
  Deny: "deny",
  Steer: "steer",
} as const);

export type PromptQueueDecision =
  (typeof PromptQueueDecision)[keyof typeof PromptQueueDecision];

export type PromptQueueRequest = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "prompt_queue";
  nonce: string;
  toolCallId: string;
};

export type PromptQueueResult = {
  version: typeof NATIVE_CONTRACT_VERSION;
  operation: "prompt_queue";
  ok: boolean;
  nonce: string;
  toolCallId: string;
  decision: PromptQueueDecision;
  steering?: string;
};

export type PromptPresenter = (prompt: {
  toolCallId: string;
}) => PromptQueueDecision | Promise<PromptQueueDecision>;

type NativePromptQueueRequest = {
  version: number;
  operation: string;
  nonce: string;
  toolCallId: string;
};

type NativePromptQueue = {
  decidePrompt(
    request: NativePromptQueueRequest,
    present: (toolCallId: string) => Promise<PromptQueueDecision>,
  ): Promise<PromptQueueResult>;
};

function failedResult(request: PromptQueueRequest): PromptQueueResult {
  return {
    version: NATIVE_CONTRACT_VERSION,
    operation: "prompt_queue",
    ok: false,
    nonce: request.nonce,
    toolCallId: request.toolCallId,
    decision: PromptQueueDecision.Deny,
  };
}

function isPromptDecision(value: unknown): value is PromptQueueDecision {
  return Object.values(PromptQueueDecision).includes(
    value as PromptQueueDecision,
  );
}

function isBoundResult(
  value: unknown,
  request: PromptQueueRequest,
): value is PromptQueueResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return (
    result.version === NATIVE_CONTRACT_VERSION &&
    result.operation === "prompt_queue" &&
    result.ok === true &&
    result.nonce === request.nonce &&
    result.toolCallId === request.toolCallId &&
    isPromptDecision(result.decision)
  );
}

/** Ask WASM to open one prompt and return that prompt's decision. */
export async function presentBoundPrompt(
  request: PromptQueueRequest,
  present: PromptPresenter,
): Promise<PromptQueueResult> {
  if (
    request.version !== NATIVE_CONTRACT_VERSION ||
    request.operation !== "prompt_queue" ||
    request.toolCallId.length === 0
  ) {
    return failedResult(request);
  }
  const packagePath = resolveNativePackagePath();
  if (!packagePath) return failedResult(request);
  let native: Partial<NativePromptQueue>;
  try {
    native = requireNativePackage(packagePath) as Partial<NativePromptQueue>;
  } catch {
    return failedResult(request);
  }
  if (typeof native.decidePrompt !== "function") return failedResult(request);
  try {
    const result = await native.decidePrompt(
      {
        version: request.version,
        operation: request.operation,
        nonce: request.nonce,
        toolCallId: request.toolCallId,
      },
      (toolCallId) => Promise.resolve(present({ toolCallId })),
    );
    return isBoundResult(result, request) ? result : failedResult(request);
  } catch {
    return failedResult(request);
  }
}
