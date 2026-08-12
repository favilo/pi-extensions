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

/** Establishes the compilable public event-adapter contract for behavioral RED. */
export function createBackgroundEventBuffer(
  _childId: string,
  _limits: BackgroundEventLimits,
): BackgroundEventBuffer {
  return {
    append() {},
    seal() {},
    snapshot: () => ({ events: [], bytes: 0, truncated: false }),
  };
}
