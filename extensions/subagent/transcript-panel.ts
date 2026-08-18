import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { NormalizedBackgroundEvent } from "./background-events.ts";

export type SubagentTranscriptPanelOptions = {
  childId: string;
  status: string;
  cwd: string;
  theme?: {
    fg(color: string, text: string): string;
    bold(text: string): string;
  };
};

export type SubagentTranscriptPanel = {
  addEvent(event: NormalizedBackgroundEvent): void;
  setStatus(status: string): void;
  render(width: number): string[];
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val) => typeof val === "bigint" ? val.toString() : val);
  } catch {
    return String(value);
  }
}

function pushSafeWrappedLines(lines: string[], text: string, width: number): void {
  const targetWidth = Math.max(1, width);
  const rawLines = text.split("\n");
  for (const raw of rawLines) {
    const wrapped = wrapTextWithAnsi(raw, targetWidth);
    if (wrapped.length === 0) {
      lines.push("");
    } else {
      for (const line of wrapped) {
        lines.push(line);
      }
    }
  }
}

export function createSubagentTranscriptPanel(options: SubagentTranscriptPanelOptions): SubagentTranscriptPanel {
  const events: NormalizedBackgroundEvent[] = [];
  let currentStatus = options.status;
  const theme = options.theme ?? {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };

  return {
    addEvent(event) {
      events.push(event);
    },
    setStatus(status) {
      currentStatus = status;
    },
    render(width) {
      const targetWidth = Math.max(1, width);
      const lines: string[] = [];
      const headerText = `Subagent ${options.childId} • ${currentStatus} • ${options.cwd}`;
      pushSafeWrappedLines(lines, theme.bold(theme.fg("accent", headerText)), targetWidth);
      lines.push("─".repeat(targetWidth));

      if (events.length === 0) {
        pushSafeWrappedLines(lines, theme.fg("dim", "(No events yet)"), targetWidth);
        return lines;
      }

      for (const event of events) {
        if (event.type === "assistant-text") {
          const payload = event.payload as { text?: string } | undefined;
          if (payload?.text) {
            pushSafeWrappedLines(lines, payload.text, targetWidth);
          }
        } else if (event.type === "tool-call") {
          const payload = event.payload as { toolName?: string; input?: unknown } | undefined;
          const toolName = payload?.toolName ?? "unknown";
          const inputStr = payload?.input ? safeStringify(payload.input) : "";
          pushSafeWrappedLines(lines, theme.fg("toolTitle", `→ tool: ${toolName} ${inputStr}`), targetWidth);
        } else if (event.type === "tool-update") {
          const payload = event.payload as { toolName?: string; update?: unknown } | undefined;
          const toolName = payload?.toolName ?? "unknown";
          pushSafeWrappedLines(lines, theme.fg("dim", `… tool update: ${toolName}`), targetWidth);
        } else if (event.type === "tool-result") {
          const payload = event.payload as { toolName?: string; result?: unknown; isError?: boolean } | undefined;
          const toolName = payload?.toolName ?? "unknown";
          const resultStr = payload?.result ? safeStringify(payload.result) : "";
          const color = payload?.isError ? "error" : "success";
          pushSafeWrappedLines(lines, theme.fg(color, `← tool result: ${toolName} ${resultStr}`), targetWidth);
        }
      }

      return lines;
    },
  };
}

export type PanelManager = {
  getActivePanelId(): string;
  registerChildPanel(childId: string, cwd: string): void;
  unregisterChildPanel(childId: string): void;
  selectPanel(panelId: string): string;
  cycleNext(): string;
  returnToMain(): string;
};

export function createPanelManager(): PanelManager {
  const panels: string[] = ["main"];
  let activeIndex = 0;

  return {
    getActivePanelId() {
      return panels[activeIndex] ?? "main";
    },
    registerChildPanel(childId) {
      if (!panels.includes(childId)) {
        panels.push(childId);
      }
    },
    unregisterChildPanel(childId) {
      const idx = panels.indexOf(childId);
      if (idx !== -1) {
        panels.splice(idx, 1);
        if (activeIndex >= panels.length || activeIndex === idx) {
          activeIndex = 0;
        }
      }
    },
    selectPanel(panelId) {
      const idx = panels.indexOf(panelId);
      if (idx !== -1) {
        activeIndex = idx;
      } else {
        activeIndex = 0;
      }
      return panels[activeIndex] ?? "main";
    },
    cycleNext() {
      if (panels.length <= 1) return "main";
      activeIndex = (activeIndex + 1) % panels.length;
      return panels[activeIndex] ?? "main";
    },
    returnToMain() {
      activeIndex = 0;
      return "main";
    },
  };
}
