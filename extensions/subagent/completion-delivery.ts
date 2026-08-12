import type { BackgroundCompletionSignal } from "./background-lifecycle.ts";

export type CompletionDeliveryOptions = { deliverAs: "steer"; triggerTurn: true };

export type CompletionSignalDispatcher = {
  notify(message: BackgroundCompletionSignal, options: CompletionDeliveryOptions): void;
  observeMessage(message: unknown): void;
  parentSettled(): void;
  close(): void;
};

type PendingCompletion = {
  message: BackgroundCompletionSignal;
  options: CompletionDeliveryOptions;
  attempts: number;
};

function acknowledgedId(message: unknown, pending: Map<string, PendingCompletion>): string | undefined {
  if (!message || typeof message !== "object") return undefined;
  const candidate = message as {
    role?: unknown;
    customType?: unknown;
    content?: unknown;
    details?: { id?: unknown; status?: unknown };
  };
  if (candidate.role !== "custom" || candidate.customType !== "subagent_finished") return undefined;
  if (typeof candidate.details?.id !== "string") return undefined;
  const expected = pending.get(candidate.details.id)?.message;
  if (!expected) return undefined;
  if (candidate.content !== expected.content || candidate.details.status !== expected.details.status) return undefined;
  return candidate.details.id;
}

/** Keeps terminal signals pending until the parent message stream acknowledges them. */
export function createCompletionSignalDispatcher(
  send: (message: BackgroundCompletionSignal, options: CompletionDeliveryOptions) => void,
  debug: (event: string, details: Record<string, unknown>) => void = () => {},
): CompletionSignalDispatcher {
  const pending = new Map<string, PendingCompletion>();
  let closed = false;

  function dispatch(completion: PendingCompletion): void {
    if (closed) return;
    completion.attempts += 1;
    const details = {
      childId: completion.message.details.id,
      status: completion.message.details.status,
      attempt: completion.attempts,
    };
    debug("completion-signal-dispatch", details);
    try {
      send(completion.message, completion.options);
      debug("completion-signal-dispatched", details);
    } catch (error) {
      debug("completion-signal-failed", {
        ...details,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    notify(message, options) {
      if (closed) return;
      const completion = { message, options, attempts: 0 };
      pending.set(message.details.id, completion);
      dispatch(completion);
    },

    observeMessage(message) {
      const id = acknowledgedId(message, pending);
      if (!id) return;
      pending.delete(id);
      debug("completion-signal-acknowledged", { childId: id });
    },

    parentSettled() {
      for (const completion of pending.values()) {
        debug("completion-signal-retry-after-settle", {
          childId: completion.message.details.id,
          attempts: completion.attempts,
        });
        dispatch(completion);
      }
    },

    close() {
      closed = true;
      pending.clear();
    },
  };
}
