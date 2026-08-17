import type { BackgroundResult } from "./background-lifecycle.ts";

/** Defensive presentation bounds remain below the model-facing result contract. */
export const MAX_EXPANDED_RESULT_BYTES = 64 * 1_024;
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

function presentationSnapshot(result: Exclude<BackgroundResult, { found: false } | { exported: true }>): unknown {
  if (result.output === undefined || Buffer.byteLength(result.output, "utf8") <= MAX_EXPANDED_OUTPUT_BYTES) {
    return result;
  }

  return {
    ...result,
    output: {
      presentationTruncated: true,
      bytes: Buffer.byteLength(result.output, "utf8"),
      preview: truncateUtf8(result.output, MAX_EXPANDED_OUTPUT_BYTES),
    },
    presentationTruncated: true,
  };
}

/** Builds collapsed and expanded display content for the compact subagent_result tool row. */
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

  if ("exported" in result && result.exported) {
    const summary = `${result.status} • exported ${result.bytesWritten} bytes -> ${result.destinationPath}`;
    return {
      summary,
      ...(expanded ? { expandedJson: prettyJson(result) } : {}),
    };
  }

  const outputBytes = result.outputBytes?.returned ?? 0;
  const truncation = result.outputTruncated ? " • truncated" : "";
  const summary = `${result.status} • ${outputBytes} bytes${truncation}`;

  return {
    summary,
    ...(expanded ? { expandedJson: prettyJson(presentationSnapshot(result)) } : {}),
  };
}
