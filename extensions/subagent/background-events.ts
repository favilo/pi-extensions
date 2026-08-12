import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export type NormalizedBackgroundEvent = {
  childId: string;
  sequence: number;
  type: "assistant-text" | "tool-call" | "tool-update" | "tool-result";
  payload: unknown;
  truncated: boolean;
};

export type BackgroundEventSnapshot = {
  events: NormalizedBackgroundEvent[];
  bytes: number;
  truncated: boolean;
};

export type BackgroundEventBuffer = {
  append(event: AgentSessionEvent): void;
  seal(): void;
  snapshot(): BackgroundEventSnapshot;
};

export type BackgroundEventLimits = {
  maxEvents: number;
  maxEventBytes: number;
  maxTotalBytes: number;
};

type Candidate = Omit<NormalizedBackgroundEvent, "childId" | "sequence" | "truncated"> & {
  toolCallId?: string;
};

function candidate(event: AgentSessionEvent): Candidate | undefined {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    return { type: "assistant-text", payload: { text: event.assistantMessageEvent.delta } };
  }
  if (event.type === "tool_execution_start") {
    return {
      type: "tool-call",
      toolCallId: event.toolCallId,
      payload: { toolCallId: event.toolCallId, toolName: event.toolName, input: event.args },
    };
  }
  if (event.type === "tool_execution_update") {
    return {
      type: "tool-update",
      toolCallId: event.toolCallId,
      payload: { toolCallId: event.toolCallId, toolName: event.toolName, update: event.partialResult },
    };
  }
  if (event.type === "tool_execution_end") {
    return {
      type: "tool-result",
      toolCallId: event.toolCallId,
      payload: { toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError },
    };
  }
  return undefined;
}

function serialize(payload: unknown): string {
  try {
    return JSON.stringify(payload, (_key, value) => typeof value === "bigint" ? value.toString() : value) ?? "null";
  } catch {
    return JSON.stringify({ unavailable: true });
  }
}

function payloadBytes(payload: unknown): number {
  return Buffer.byteLength(serialize(payload), "utf8");
}

function boundedPayload(payload: unknown, maximum: number): { payload: unknown; bytes: number; truncated: boolean } {
  const serialized = serialize(payload);
  const bytes = Buffer.byteLength(serialized, "utf8");
  if (bytes <= maximum) return { payload, bytes, truncated: false };

  let value = "";
  for (const character of serialized) {
    const candidate = `${value}${character}`;
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > maximum) break;
    value = candidate;
  }
  return { payload: value, bytes: Buffer.byteLength(JSON.stringify(value), "utf8"), truncated: true };
}

/** Creates a session-memory adapter for exposed, non-reasoning child events. */
export function createBackgroundEventBuffer(
  childId: string,
  limits: BackgroundEventLimits,
): BackgroundEventBuffer {
  const events: Array<NormalizedBackgroundEvent & { bytes: number; toolCallId?: string }> = [];
  let sequence = 0;
  let bytes = 0;
  let sealed = false;
  let truncated = false;

  function remove(index: number): void {
    const [removed] = events.splice(index, 1);
    if (removed) bytes -= removed.bytes;
  }

  return {
    append(event) {
      if (sealed) return;
      const normalized = candidate(event);
      if (!normalized) return;
      sequence += 1;

      if (normalized.type === "tool-update") {
        const previous = events.findIndex((item) => item.type === "tool-update" && item.toolCallId === normalized.toolCallId);
        if (previous >= 0) remove(previous);
      }

      const bounded = boundedPayload(normalized.payload, Math.min(limits.maxEventBytes, limits.maxTotalBytes));
      while (events.length >= limits.maxEvents || bytes + bounded.bytes > limits.maxTotalBytes) {
        if (events.length === 0) break;
        remove(0);
        truncated = true;
      }
      events.push({
        childId,
        sequence,
        type: normalized.type,
        payload: bounded.payload,
        truncated: bounded.truncated,
        bytes: bounded.bytes,
        ...(normalized.toolCallId ? { toolCallId: normalized.toolCallId } : {}),
      });
      bytes += bounded.bytes;
      truncated ||= bounded.truncated;
    },

    seal() {
      sealed = true;
    },

    snapshot() {
      return {
        events: events.map(({ bytes: _bytes, toolCallId: _toolCallId, ...event }) => structuredClone(event)),
        bytes,
        truncated,
      };
    },
  };
}
