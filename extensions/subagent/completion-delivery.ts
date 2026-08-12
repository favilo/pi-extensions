import type { BackgroundCompletionSignal } from "./background-lifecycle.ts";

export type CompletionDeliveryOptions = { deliverAs: "steer"; triggerTurn: true };

export type CompletionSignalDispatcher = {
  notify(message: BackgroundCompletionSignal, options: CompletionDeliveryOptions): void;
  observeMessage(message: unknown): void;
  parentSettled(): void;
  close(): void;
};

/** Keeps terminal signals pending until the parent message stream acknowledges them. */
export function createCompletionSignalDispatcher(
  _send: (message: BackgroundCompletionSignal, options: CompletionDeliveryOptions) => void,
  _debug: (event: string, details: Record<string, unknown>) => void = () => {},
): CompletionSignalDispatcher {
  return {
    notify() {},
    observeMessage() {},
    parentSettled() {},
    close() {},
  };
}
