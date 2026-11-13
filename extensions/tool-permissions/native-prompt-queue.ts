import { NATIVE_CONTRACT_VERSION } from "./native-contract.ts";

export const NATIVE_PROMPT_QUEUE_NONCE =
  "tool-permissions-prompt-queue" as const;

export type PromptQueueDecision = "allow" | "deny" | "steer";

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

/** Stub. Returns a deny with no tool-call id until WASM owns the prompt. */
export async function presentBoundPrompt(
  request: PromptQueueRequest,
  _present: PromptPresenter,
): Promise<PromptQueueResult> {
  return {
    version: request.version,
    operation: "prompt_queue",
    ok: false,
    nonce: request.nonce,
    toolCallId: "",
    decision: "deny",
  };
}
