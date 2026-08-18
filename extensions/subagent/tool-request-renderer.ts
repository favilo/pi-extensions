import { wrapTextWithAnsi } from "@earendil-works/pi-tui";

export type SubagentToolRequestCallArgs = {
  toolName?: string;
  input?: unknown;
};

export type Theme = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

export type RenderComponent = {
  render(width: number): string[];
  invalidate?(): void;
};

function pushWrapped(lines: string[], text: string, width: number): void {
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

function safeFormatValue(val: unknown): string {
  if (typeof val === "string") return val;
  try {
    return JSON.stringify(val, (_key, v) => typeof v === "bigint" ? v.toString() : v, 2) ?? String(val);
  } catch {
    return String(val);
  }
}

export function renderSubagentToolRequestCall(
  args: SubagentToolRequestCallArgs,
  theme: Theme,
): RenderComponent {
  const toolName = args.toolName ?? "unknown";
  const rawInput = args.input;
  const inputObj = (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) ? rawInput as Record<string, unknown> : {};

  return {
    render(width: number) {
      const targetWidth = Math.max(1, width);
      const lines: string[] = [];

      const header = theme.bold(theme.fg("toolTitle", `subagent-tool-request → ${toolName}`));
      pushWrapped(lines, header, targetWidth);

      if (toolName === "bash" && typeof inputObj.command === "string") {
        lines.push("$ ");
        pushWrapped(lines, theme.fg("syntaxKeyword", inputObj.command), targetWidth);
      } else {
        const entries = Object.entries(inputObj);
        if (entries.length === 0) {
          lines.push(theme.fg("dim", "  (no parameters)"));
        } else {
          for (const [key, val] of entries) {
            const formattedVal = safeFormatValue(val);
            const entryText = `  ${key}: ${formattedVal}`;
            pushWrapped(lines, theme.fg("dim", entryText), targetWidth);
          }
        }
      }

      return lines;
    },
    invalidate() {},
  };
}
