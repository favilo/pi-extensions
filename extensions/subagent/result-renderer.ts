import type { BackgroundResult } from "./background-lifecycle.ts";

export type SubagentResultDisplay = {
  summary: string;
  expandedJson?: string;
};

/** Builds collapsed and expanded display content for the subagent_result tool row. */
export function subagentResultDisplay(
  _result: BackgroundResult,
  _expanded: boolean,
): SubagentResultDisplay {
  return { summary: "subagent result" };
}
