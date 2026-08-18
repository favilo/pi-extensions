import type { NormalizedBackgroundEvent } from "./background-events.ts";

export type SubagentTranscriptPanelOptions = {
  childId: string;
  status: string;
  cwd: string;
  theme: unknown;
};

export type SubagentTranscriptPanel = {
  addEvent(event: NormalizedBackgroundEvent): void;
  setStatus(status: string): void;
  render(width: number): string[];
};

export function createSubagentTranscriptPanel(_options: SubagentTranscriptPanelOptions): SubagentTranscriptPanel {
  return {
    addEvent(_event) {},
    setStatus(_status) {},
    render(_width) {
      return [];
    },
  };
}
