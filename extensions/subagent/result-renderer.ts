import type { BackgroundResult } from "./background-lifecycle.ts";

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
    ...(expanded ? { expandedJson: prettyJson(result) } : {}),
  };
}
