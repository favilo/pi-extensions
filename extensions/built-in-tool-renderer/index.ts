/**
 * Compact custom rendering for built-in tools.
 *
 * Re-registers read, bash, grep, find, ls, edit, and write with their
 * original behavior while replacing their TUI renderers with concise summaries.
 */

import type {
  BashToolDetails,
  EditToolDetails,
  ExtensionAPI,
  FindToolDetails,
  GrepToolDetails,
  LsToolDetails,
  ReadToolDetails,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { registerPublishedTool } from "../tool-registry/index.ts";
import { steeringAnnotation, toolErrorText, toolOutputTexts } from "./result.ts";

const reasonParameterSchema = {
  type: "string",
  description: "One sentence on why you are calling this tool; shown to the user in the permission prompt and history.",
} as const;

/** Admit an optional agent-supplied reason into a built-in tool's parameter schema. */
function withReasonParameter<T>(parameters: T): T {
  const schema = parameters as { type?: string; properties?: Record<string, unknown> };
  if (schema?.type !== "object" || !schema.properties) return parameters;
  return { ...schema, properties: { ...schema.properties, reason: reasonParameterSchema } } as T;
}

/** Strip the renderer-owned reason before delegating to the original tool. */
function withoutReason<T>(params: T): T {
  if (!params || typeof params !== "object" || !("reason" in params)) return params;
  const { reason: _reason, ...rest } = params as Record<string, unknown>;
  return rest as T;
}

/** History suffix surfacing the agent-supplied call reason, when present. */
function reasonSuffix(args: Record<string, unknown>, theme: Theme): string {
  const reason = args.reason;
  return typeof reason === "string" && reason.trim() ? `\n${theme.fg("dim", `reason: ${reason.trim()}`)}` : "";
}

type RenderableResult = { content: Array<{ type: string; text?: string }> };

/** Finalize a rendered result, prepending the steering line when the result carries an annotation. */
function withSteering(text: string, result: RenderableResult, theme: Theme): Text {
  const steering = steeringAnnotation(result);
  const leading = steering ? `${theme.fg("warning", `steering: ${steering}`)}\n` : "";
  return new Text(leading + text, 0, 0);
}

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();

  const originalRead = createReadTool(cwd);
  registerPublishedTool(pi, {
    name: "read",
    label: "read",
    description: originalRead.description,
    parameters: originalRead.parameters,

    async execute(toolCallId, params, signal, onUpdate) {
      return originalRead.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("read "));
      text += theme.fg("accent", args.path);
      if (args.offset || args.limit) {
        const parts: string[] = [];
        if (args.offset) parts.push(`offset=${args.offset}`);
        if (args.limit) parts.push(`limit=${args.limit}`);
        text += theme.fg("dim", ` (${parts.join(", ")})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "Reading..."), 0, 0);

      const details = result.details as ReadToolDetails | undefined;
      const content = result.content[0];

      if (content?.type === "image") return new Text(theme.fg("success", "Image loaded"), 0, 0);
      if (content?.type !== "text") return new Text(theme.fg("error", "No content"), 0, 0);

      const lineCount = content.text.split("\n").length;
      let text = theme.fg("success", `${lineCount} lines`);

      if (details?.truncation?.truncated) {
        text += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
      }

      if (expanded) {
        const lines = content.text.split("\n").slice(0, 15);
        for (const line of lines) text += `\n${theme.fg("dim", line)}`;
        if (lineCount > 15) text += `\n${theme.fg("muted", `... ${lineCount - 15} more lines`)}`;
      }

      return withSteering(text, result, theme);
    },
  });

  const originalBash = createBashTool(cwd);
  registerPublishedTool(pi, {
    name: "bash",
    label: "bash",
    description: originalBash.description,
    parameters: withReasonParameter(originalBash.parameters),

    async execute(toolCallId, params, signal, onUpdate) {
      return originalBash.execute(toolCallId, withoutReason(params), signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("$ "));
      const cmd = args.command.length > 80 ? `${args.command.slice(0, 77)}...` : args.command;
      text += theme.fg("accent", cmd);
      if (args.timeout) text += theme.fg("dim", ` (timeout: ${args.timeout}s)`);
      text += reasonSuffix(args, theme);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "Running..."), 0, 0);

      const details = result.details as BashToolDetails | undefined;
      const content = result.content[0];
      const output = content?.type === "text" ? content.text : "";
      const exitMatch = output.match(/exit code: (\d+)/);
      const exitCode = exitMatch ? Number.parseInt(exitMatch[1], 10) : null;
      const lineCount = output.split("\n").filter((line) => line.trim()).length;

      let text = exitCode === 0 || exitCode === null ? theme.fg("success", "done") : theme.fg("error", `exit ${exitCode}`);
      text += theme.fg("dim", ` (${lineCount} lines)`);

      if (details?.truncation?.truncated) text += theme.fg("warning", " [truncated]");

      if (expanded) {
        const fullOutput = toolOutputTexts(result).join("\n");
        const lines = fullOutput.split("\n").slice(0, 20);
        for (const line of lines) text += `\n${theme.fg("dim", line)}`;
        if (fullOutput.split("\n").length > 20) text += `\n${theme.fg("muted", "... more output")}`;
      }

      return withSteering(text, result, theme);
    },
  });

  const originalGrep = createGrepTool(cwd);
  registerPublishedTool(pi, {
    name: "grep",
    label: "grep",
    description: originalGrep.description,
    parameters: originalGrep.parameters,

    async execute(toolCallId, params, signal, onUpdate) {
      return originalGrep.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("grep "));
      text += theme.fg("accent", args.pattern);
      if (args.path) text += theme.fg("dim", ` in ${args.path}`);
      if (args.glob) text += theme.fg("dim", ` (${args.glob})`);
      if (args.ignoreCase) text += theme.fg("dim", " -i");
      if (args.literal) text += theme.fg("dim", " literal");
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "Searching..."), 0, 0);

      const details = result.details as GrepToolDetails | undefined;
      const content = result.content[0];
      const output = content?.type === "text" ? content.text : "";
      const lines = output.split("\n").filter((line) => line.trim());

      let text = theme.fg("success", `${lines.length} matches`);
      if (details?.matchLimitReached) text += theme.fg("warning", ` (limit ${details.matchLimitReached})`);
      if (details?.truncation?.truncated) text += theme.fg("warning", " [truncated]");
      if (details?.linesTruncated) text += theme.fg("warning", " [long lines truncated]");

      if (expanded) {
        for (const line of lines.slice(0, 20)) text += `\n${theme.fg("dim", line)}`;
        if (lines.length > 20) text += `\n${theme.fg("muted", `... ${lines.length - 20} more matches`)}`;
      }

      return withSteering(text, result, theme);
    },
  });

  const originalFind = createFindTool(cwd);
  registerPublishedTool(pi, {
    name: "find",
    label: "find",
    description: originalFind.description,
    parameters: originalFind.parameters,

    async execute(toolCallId, params, signal, onUpdate) {
      return originalFind.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("find "));
      text += theme.fg("accent", args.pattern);
      if (args.path) text += theme.fg("dim", ` in ${args.path}`);
      if (args.limit) text += theme.fg("dim", ` (limit=${args.limit})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "Finding..."), 0, 0);

      const details = result.details as FindToolDetails | undefined;
      const content = result.content[0];
      const output = content?.type === "text" ? content.text : "";
      const lines = output.split("\n").filter((line) => line.trim());

      let text = theme.fg("success", `${lines.length} paths`);
      if (details?.resultLimitReached) text += theme.fg("warning", ` (limit ${details.resultLimitReached})`);
      if (details?.truncation?.truncated) text += theme.fg("warning", " [truncated]");

      if (expanded) {
        for (const line of lines.slice(0, 20)) text += `\n${theme.fg("dim", line)}`;
        if (lines.length > 20) text += `\n${theme.fg("muted", `... ${lines.length - 20} more paths`)}`;
      }

      return withSteering(text, result, theme);
    },
  });

  const originalLs = createLsTool(cwd);
  registerPublishedTool(pi, {
    name: "ls",
    label: "ls",
    description: originalLs.description,
    parameters: originalLs.parameters,

    async execute(toolCallId, params, signal, onUpdate) {
      return originalLs.execute(toolCallId, params, signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("ls "));
      text += theme.fg("accent", args.path ?? ".");
      if (args.limit) text += theme.fg("dim", ` (limit=${args.limit})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, _context) {
      if (isPartial) return new Text(theme.fg("warning", "Listing..."), 0, 0);

      const details = result.details as LsToolDetails | undefined;
      const content = result.content[0];
      const output = content?.type === "text" ? content.text : "";
      const lines = output.split("\n").filter((line) => line.trim());

      let text = theme.fg("success", `${lines.length} entries`);
      if (details?.entryLimitReached) text += theme.fg("warning", ` (limit ${details.entryLimitReached})`);
      if (details?.truncation?.truncated) text += theme.fg("warning", " [truncated]");

      if (expanded) {
        for (const line of lines.slice(0, 20)) text += `\n${theme.fg("dim", line)}`;
        if (lines.length > 20) text += `\n${theme.fg("muted", `... ${lines.length - 20} more entries`)}`;
      }

      return withSteering(text, result, theme);
    },
  });

  const originalEdit = createEditTool(cwd);
  registerPublishedTool(pi, {
    name: "edit",
    label: "edit",
    description: originalEdit.description,
    parameters: withReasonParameter(originalEdit.parameters),
    renderShell: "self",

    async execute(toolCallId, params, signal, onUpdate) {
      return originalEdit.execute(toolCallId, withoutReason(params), signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("edit "));
      text += theme.fg("accent", args.path);
      text += reasonSuffix(args, theme);
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Editing..."), 0, 0);

      const errorText = toolErrorText(result, context.isError, "Edit failed");
      if (errorText) return new Text(theme.fg("error", errorText), 0, 0);

      const details = result.details as EditToolDetails | undefined;
      const content = result.content[0];
      if (content?.type === "text" && content.text.startsWith("Error")) {
        return new Text(theme.fg("error", content.text.split("\n")[0]), 0, 0);
      }

      if (!details?.diff) return withSteering(theme.fg("success", "Edited"), result, theme);

      const diffLines = details.diff.split("\n");
      let additions = 0;
      let removals = 0;
      for (const line of diffLines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) removals++;
      }

      let text = theme.fg("success", `+${additions}`);
      text += theme.fg("dim", " / ");
      text += theme.fg("error", `-${removals}`);

      if (expanded) {
        for (const line of diffLines.slice(0, 30)) {
          if (line.startsWith("+") && !line.startsWith("+++")) text += `\n${theme.fg("success", line)}`;
          else if (line.startsWith("-") && !line.startsWith("---")) text += `\n${theme.fg("error", line)}`;
          else text += `\n${theme.fg("dim", line)}`;
        }
        if (diffLines.length > 30) text += `\n${theme.fg("muted", `... ${diffLines.length - 30} more diff lines`)}`;
      }

      return withSteering(text, result, theme);
    },
  });

  const originalWrite = createWriteTool(cwd);
  registerPublishedTool(pi, {
    name: "write",
    label: "write",
    description: originalWrite.description,
    parameters: withReasonParameter(originalWrite.parameters),

    async execute(toolCallId, params, signal, onUpdate) {
      return originalWrite.execute(toolCallId, withoutReason(params), signal, onUpdate);
    },

    renderCall(args, theme, _context) {
      let text = theme.fg("toolTitle", theme.bold("write "));
      text += theme.fg("accent", args.path);
      const lineCount = args.content.split("\n").length;
      text += theme.fg("dim", ` (${lineCount} lines)`);
      text += reasonSuffix(args, theme);
      return new Text(text, 0, 0);
    },

    renderResult(result, { isPartial }, theme, context) {
      if (isPartial) return new Text(theme.fg("warning", "Writing..."), 0, 0);

      const errorText = toolErrorText(result, context.isError, "Write failed");
      if (errorText) return new Text(theme.fg("error", errorText), 0, 0);

      return withSteering(theme.fg("success", "Written"), result, theme);
    },
  });
}
