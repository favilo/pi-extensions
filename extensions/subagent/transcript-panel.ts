import { wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { NormalizedBackgroundEvent } from "./background-events.ts";

export type SubagentTranscriptPanelOptions = {
  childId: string;
  status: string;
  cwd: string;
  taskPrompt?: string;
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

export type SubagentTabBarOptions = {
  panels: readonly string[];
  activePanelId: string;
  theme?: {
    fg(color: string, text: string): string;
    bold(text: string): string;
  };
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_key, val) => typeof val === "bigint" ? val.toString() : val);
  } catch {
    return String(value);
  }
}

function pushSafeWrappedLines(lines: string[], text: string, width: number): void {
  const termWidth = process.stdout.columns || 80;
  const effectiveWidth = Math.max(40, width > 10 ? width : termWidth);
  const rawLines = text.split("\n");

  for (const raw of rawLines) {
    if (raw.length <= effectiveWidth) {
      lines.push(raw);
    } else {
      const wrapped = wrapTextWithAnsi(raw, effectiveWidth);
      if (wrapped.length === 0) {
        lines.push("");
      } else {
        for (const line of wrapped) {
          lines.push(line);
        }
      }
    }
  }
}

function shortPanelId(panelId: string): string {
  return panelId.length > 8 ? panelId.slice(0, 8) : panelId;
}

export function renderSubagentTabBar(options: SubagentTabBarOptions, width: number): string[] {
  const theme = options.theme ?? {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  };
  const tabs = options.panels
    .filter((panel) => panel !== "main")
    .map((panel, index) => {
      const label = `${index + 1}:${shortPanelId(panel)}`;
      return panel === options.activePanelId
        ? theme.bold(theme.fg("accent", `[${label}]`))
        : theme.fg("dim", ` ${label} `);
    });

  const text = tabs.length > 0
    ? `Subagents ${tabs.join(" ")}  Ctrl+Tab/Alt+T next • Alt+Shift+T prev • d dismiss • Esc main`
    : "Subagents (none)";
  const lines: string[] = [];
  pushSafeWrappedLines(lines, text, width);
  return lines;
}

function steeringAnnotation(text: string): string | undefined {
  const match = text.match(/<user-steering\b[^>]*>\s*([\s\S]*?)\s*<\/user-steering>/);
  return match?.[1]?.trim() || undefined;
}

function appendUniqueLine(lines: string[], value: string | undefined): void {
  const trimmed = value?.trim();
  if (trimmed && !lines.includes(trimmed)) lines.push(trimmed);
}

function extractCleanResultText(result: unknown): string | undefined {
  if (!result) return undefined;
  if (typeof result === "string") {
    const trimmed = result.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return extractCleanResultText(JSON.parse(trimmed)) ?? trimmed;
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }

  if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;
    const lines: string[] = [];
    const steering = typeof obj.steering === "string" && obj.steering.trim()
      ? obj.steering.trim()
      : undefined;

    if (typeof obj.output === "string") appendUniqueLine(lines, obj.output);

    const inner = (obj.value && typeof obj.value === "object" && obj.value !== null)
      ? (obj.value as Record<string, unknown>)
      : (obj.result && typeof obj.result === "object" && obj.result !== null)
        ? (obj.result as Record<string, unknown>)
        : obj;

    if (inner !== obj && typeof inner.steering === "string") appendUniqueLine(lines, `Prompt: ${inner.steering}`);
    if (typeof inner.output === "string") appendUniqueLine(lines, inner.output);

    const content = inner.content ?? obj.content;
    if (Array.isArray(content)) {
      for (const item of content) {
        if (!item || item.type !== "text" || typeof item.text !== "string") continue;
        const annotation = steeringAnnotation(item.text);
        if (annotation) {
          appendUniqueLine(lines, `Prompt: ${annotation}`);
          continue;
        }
        appendUniqueLine(lines, extractCleanResultText(item.text));
      }
    }

    if (steering) appendUniqueLine(lines, `Prompt: ${steering}`);
    if (typeof obj.reason === "string" && obj.reason.trim()) appendUniqueLine(lines, `Blocked: ${obj.reason.trim()}`);
    if (typeof obj.summary === "string" && obj.summary.trim()) appendUniqueLine(lines, obj.summary.trim());
    if (lines.length > 0) return lines.join("\n");
    if (typeof obj.status === "string" && obj.status !== "allowed") return `Status: ${obj.status}`;
  }

  return undefined;
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
      const termWidth = process.stdout.columns || 80;
      const effectiveWidth = Math.max(40, width > 10 ? width : termWidth);
      const lines: string[] = [];
      const headerText = `Subagent ${options.childId} • ${currentStatus} • ${options.cwd}`;
      pushSafeWrappedLines(lines, theme.bold(theme.fg("accent", headerText)), effectiveWidth);
      lines.push("─".repeat(effectiveWidth));
      if (options.taskPrompt?.trim()) {
        pushSafeWrappedLines(lines, theme.bold("Prompt:"), effectiveWidth);
        pushSafeWrappedLines(lines, options.taskPrompt.trim(), effectiveWidth);
        lines.push("─".repeat(effectiveWidth));
      }

      if (events.length === 0) {
        pushSafeWrappedLines(lines, theme.fg("dim", "(No events yet)"), effectiveWidth);
        return lines;
      }

      let assistantText = "";
      const flushAssistantText = () => {
        if (!assistantText) return;
        pushSafeWrappedLines(lines, assistantText, effectiveWidth);
        assistantText = "";
      };

      for (const event of events) {
        if (event.type === "assistant-text") {
          const payload = event.payload as { text?: string } | undefined;
          if (payload?.text) {
            assistantText += payload.text;
          }
        } else if (event.type === "tool-call") {
          flushAssistantText();
          const payload = event.payload as { toolName?: string; input?: unknown } | undefined;
          const rawName = payload?.toolName ?? "unknown";
          const rawInput = payload?.input;

          if (rawName === "subagent-tool-request" && typeof rawInput === "object" && rawInput !== null) {
            const req = rawInput as { toolName?: string; input?: unknown };
            const reqTool = req.toolName ?? "tool";
            const reqInput = (req.input && typeof req.input === "object" && req.input !== null) ? req.input as Record<string, unknown> : {};
            if (reqTool === "bash" && typeof reqInput.command === "string") {
              pushSafeWrappedLines(lines, theme.bold(theme.fg("toolTitle", `→ $ ${reqInput.command}`)), effectiveWidth);
            } else if (typeof reqInput.path === "string") {
              pushSafeWrappedLines(lines, theme.bold(theme.fg("toolTitle", `→ ${reqTool} ${reqInput.path}`)), effectiveWidth);
            } else {
              const argsStr = Object.entries(reqInput).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
              pushSafeWrappedLines(lines, theme.bold(theme.fg("toolTitle", `→ ${reqTool} ${argsStr}`)), effectiveWidth);
            }
          } else {
            const inputStr = rawInput ? safeStringify(rawInput) : "";
            pushSafeWrappedLines(lines, theme.bold(theme.fg("toolTitle", `→ tool: ${rawName} ${inputStr}`)), effectiveWidth);
          }
        } else if (event.type === "tool-update") {
          flushAssistantText();
          const payload = event.payload as { toolName?: string; update?: unknown } | undefined;
          const toolName = payload?.toolName ?? "unknown";
          pushSafeWrappedLines(lines, theme.fg("dim", `… tool update: ${toolName}`), effectiveWidth);
        } else if (event.type === "tool-result") {
          flushAssistantText();
          const payload = event.payload as { toolName?: string; result?: unknown; isError?: boolean } | undefined;
          const rawResult = payload?.result;
          const color = payload?.isError ? "error" : "dim";
          const textContent = extractCleanResultText(rawResult);

          if (textContent) {
            pushSafeWrappedLines(lines, theme.fg(color, textContent), effectiveWidth);
          } else if (payload?.isError) {
            pushSafeWrappedLines(lines, theme.fg("error", "← tool failed"), effectiveWidth);
          }
        }
      }
      flushAssistantText();

      return lines;
    },
  };
}

export type PanelManager = {
  getActivePanelId(): string;
  getActiveIndex(): number;
  getPanels(): readonly string[];
  registerChildPanel(childId: string, cwd: string): void;
  unregisterChildPanel(childId: string): void;
  selectPanel(panelId: string): string;
  cycleNext(): string;
  cyclePrevious(): string;
  returnToMain(): string;
};

export function createPanelManager(): PanelManager {
  const panels: string[] = ["main"];
  let activeIndex = 0;

  return {
    getActivePanelId() {
      return panels[activeIndex] ?? "main";
    },
    getActiveIndex() {
      return activeIndex;
    },
    getPanels() {
      return [...panels];
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
    cyclePrevious() {
      if (panels.length <= 1) return "main";
      activeIndex = (activeIndex - 1 + panels.length) % panels.length;
      return panels[activeIndex] ?? "main";
    },
    returnToMain() {
      activeIndex = 0;
      return "main";
    },
  };
}
