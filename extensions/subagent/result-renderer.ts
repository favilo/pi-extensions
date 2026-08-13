import type { BackgroundResult } from "./background-lifecycle.ts";

/** Terminal display bounds prevent result retrieval from flooding the TUI. */
export const MAX_EXPANDED_RESULT_BYTES = 64 * 1_024;
export const MAX_EXPANDED_RESULT_EVENTS = 20;
const MAX_EXPANDED_EVENT_PAYLOAD_BYTES = 2 * 1_024;
const MAX_EXPANDED_OUTPUT_BYTES = 8 * 1_024;

export type SubagentResultDisplay = {
  summary: string;
  expandedJson?: string;
};

function prettyJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, nested) => typeof nested === "bigint" ? nested.toString() : nested,
    2,
  ) ?? "null";
}

function truncateUtf8(value: string, maximum: number): string {
  let truncated = "";
  for (const character of value) {
    if (Buffer.byteLength(truncated + character, "utf8") > maximum) break;
    truncated += character;
  }
  return truncated;
}

function presentationValue(value: unknown, maximum: number): { value: unknown; truncated: boolean } {
  const serialized = prettyJson(value);
  if (Buffer.byteLength(serialized, "utf8") <= maximum) return { value, truncated: false };
  return {
    value: {
      presentationTruncated: true,
      bytes: Buffer.byteLength(serialized, "utf8"),
      preview: truncateUtf8(serialized, maximum),
    },
    truncated: true,
  };
}

function presentationSnapshot(result: Exclude<BackgroundResult, { found: false }>): unknown {
  let presentationTruncated = false;
  const events = result.events.events.slice(0, MAX_EXPANDED_RESULT_EVENTS).map((event) => {
    const payload = presentationValue(event.payload, MAX_EXPANDED_EVENT_PAYLOAD_BYTES);
    presentationTruncated ||= payload.truncated;
    return { ...event, payload: payload.value };
  });
  const output = result.output === undefined
    ? undefined
    : presentationValue(result.output, MAX_EXPANDED_OUTPUT_BYTES);
  presentationTruncated ||= output?.truncated ?? false;
  const omitted = result.events.events.length - events.length;
  presentationTruncated ||= omitted > 0;

  return {
    found: result.found,
    id: result.id,
    cwd: result.cwd,
    status: result.status,
    terminal: result.terminal,
    events: {
      events,
      bytes: result.events.bytes,
      truncated: result.events.truncated,
      omitted,
    },
    ...(output ? { output: output.value } : {}),
    ...(result.outputTruncated ? { outputTruncated: true } : {}),
    ...(presentationTruncated ? { presentationTruncated: true } : {}),
  };
}

/** Builds collapsed and expanded display content for the subagent_result tool row. */
export function subagentResultDisplay(
  result: BackgroundResult,
  expanded: boolean,
): SubagentResultDisplay {
  if (!result.found) {
    return {
      summary: "unknown subagent",
      ...(expanded ? { expandedJson: prettyJson(result) } : {}),
    };
  }

  const eventCount = result.events.events.length;
  const eventLabel = eventCount === 1 ? "event" : "events";
  const truncation = result.events.truncated || result.outputTruncated ? " • truncated" : "";
  const summary = `${result.status} • ${eventCount} ${eventLabel} • ${result.events.bytes} bytes${truncation}`;

  return {
    summary,
    ...(expanded ? { expandedJson: prettyJson(presentationSnapshot(result)) } : {}),
  };
}
