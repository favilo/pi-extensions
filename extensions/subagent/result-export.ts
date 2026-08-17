import type { SessionManager } from "@earendil-works/pi-coding-agent";

export type ExportedAssistantEvent = {
  type: "assistant";
  timestamp: number;
  text?: string;
  toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>;
};

export type ExportedToolResultEvent = {
  type: "tool_result";
  timestamp: number;
  toolCallId: string;
  toolName: string;
  isError: boolean;
  text?: string;
};

export type ExportedEvent = ExportedAssistantEvent | ExportedToolResultEvent;

type MessageContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "toolCall"; id: string; name: string; args: Record<string, unknown> }
  | { type: string; [key: string]: unknown };

type StoredMessage = {
  role: string;
  content: MessageContentBlock[];
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

export type SubagentExportSnapshot = {
  schemaVersion: 1;
  childId: string;
  cwd: string;
  status: string;
  terminal: boolean;
  complete: boolean;
  capturedAt: string;
  finalOutput?: string;
  events: ExportedEvent[];
};

export type BuildSnapshotOptions = {
  id: string;
  cwd: string;
  status: string;
  terminal: boolean;
  sessionManager: SessionManager;
};

export type ExportToFileOptions = BuildSnapshotOptions & {
  destinationPath: string;
  overwrite?: boolean;
  signal?: AbortSignal;
};

export type ExportToFileResult = {
  success: boolean;
  destinationPath: string;
  bytesWritten: number;
  overwritten: boolean;
  snapshot: SubagentExportSnapshot;
};

export type SubagentResultExporter = {
  buildSnapshot(options: BuildSnapshotOptions): SubagentExportSnapshot;
  exportToFile(options: ExportToFileOptions): Promise<ExportToFileResult>;
};

function extractText(content: MessageContentBlock[]): string | undefined {
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
      parts.push(block.text);
    }
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
}

export function createSubagentResultExporter(): SubagentResultExporter {
  return {
    async exportToFile(options) {
      const snapshot = this.buildSnapshot(options);
      return {
        success: false,
        destinationPath: options.destinationPath,
        bytesWritten: 0,
        overwritten: false,
        snapshot,
      };
    },
    buildSnapshot(options) {
      const entries = options.sessionManager.getBranch();
      const events: ExportedEvent[] = [];
      let finalOutput: string | undefined;

      for (const entry of entries) {
        if (entry.type !== "message") continue;
        const message = entry.message as unknown as StoredMessage;

        if (message.role === "assistant") {
          const text = extractText(message.content);
          const toolCalls = message.content
            .filter((block): block is Extract<MessageContentBlock, { type: "toolCall" }> => block.type === "toolCall")
            .map((call) => ({
              id: call.id,
              name: call.name,
              args: call.args ?? {},
            }));

          events.push({
            type: "assistant",
            timestamp: message.timestamp,
            ...(text !== undefined ? { text } : {}),
            toolCalls,
          });

          if (text !== undefined) {
            finalOutput = text;
          }
        } else if (message.role === "toolResult") {
          const text = extractText(message.content);
          events.push({
            type: "tool_result",
            timestamp: message.timestamp,
            toolCallId: message.toolCallId ?? "",
            toolName: message.toolName ?? "",
            isError: message.isError ?? false,
            ...(text !== undefined ? { text } : {}),
          });
        }
      }

      const isTerminal = options.terminal;

      return {
        schemaVersion: 1,
        childId: options.id,
        cwd: options.cwd,
        status: options.status,
        terminal: isTerminal,
        complete: isTerminal,
        capturedAt: new Date().toISOString(),
        ...(isTerminal && finalOutput !== undefined ? { finalOutput } : {}),
        events,
      };
    },
  };
}
