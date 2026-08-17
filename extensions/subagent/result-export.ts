import type { SessionManager } from "@earendil-works/pi-coding-agent";

export type SubagentExportSnapshot = {
  schemaVersion: 1;
  childId: string;
  cwd: string;
  status: string;
  terminal: boolean;
  complete: boolean;
  capturedAt: string;
  finalOutput?: string;
  events: Array<Record<string, unknown>>;
};

export type BuildSnapshotOptions = {
  id: string;
  cwd: string;
  status: string;
  terminal: boolean;
  sessionManager: SessionManager;
};

export type SubagentResultExporter = {
  buildSnapshot(options: BuildSnapshotOptions): SubagentExportSnapshot;
};

export function createSubagentResultExporter(): SubagentResultExporter {
  return {
    buildSnapshot(_options) {
      return {
        schemaVersion: 1,
        childId: "",
        cwd: "",
        status: "",
        terminal: false,
        complete: false,
        capturedAt: new Date().toISOString(),
        events: [],
      };
    },
  };
}
