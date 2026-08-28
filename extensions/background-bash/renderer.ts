import { Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { BackgroundBashTask, BackgroundBashStatus } from "./lifecycle.ts";
import type { BackgroundBashOutput, CapturedStream } from "./output.ts";

function statusColor(status: BackgroundBashStatus): "success" | "error" | "warning" {
  switch (status) {
    case "completed": return "success";
    case "failed":
    case "cancelled":
    case "timed_out": return "error";
    default: return "warning";
  }
}

function elapsedSeconds(task: Pick<BackgroundBashTask, "startedAt" | "finishedAt">): number {
  const end = task.finishedAt ?? Date.now();
  return Math.max(0, Math.round((end - (task.startedAt ?? end)) / 1000));
}

function renderStream(label: string, stream: CapturedStream, theme: Theme): string[] {
  const lines: string[] = [theme.fg("dim", `${label}:`)];
  if (stream.text) {
    for (const line of stream.text.split("\n").filter((l) => l.trim() || l === stream.text.split("\n").at(-1))) {
      lines.push(theme.fg("dim", line));
    }
  }
  if (stream.truncated) {
    lines.push(theme.fg("warning", `[truncated: ${stream.totalLines} lines, ${stream.totalBytes} bytes]`));
  }
  return lines;
}

function renderOutput(output: BackgroundBashOutput | undefined, theme: Theme): string[] {
  if (!output) return [];
  return [...renderStream("stdout", output.stdout, theme), ...renderStream("stderr", output.stderr, theme)];
}

/** Compact render for a background bash launch call row. */
export function renderBackgroundBashLaunchCall(args: { command?: string }, theme: Theme): Text {
  const command = args.command ?? "";
  const firstLine = command.split("\n")[0] ?? "";
  const display = firstLine.length > 77 ? `${firstLine.slice(0, 77)}...` : firstLine;
  return new Text(`${theme.fg("toolTitle", theme.bold("$ "))}${theme.fg("accent", display)} ${theme.fg("dim", "(background)")}`, 0, 0);
}

/** Compact render for a background bash launch result row. */
export function renderBackgroundBashLaunchResult(details: BackgroundBashTask, options: { expanded: boolean }, theme: Theme): Text {
  const color = statusColor(details.status);
  const elapsed = elapsedSeconds(details);
  let text = theme.fg(color, details.status);
  text += theme.fg("dim", ` (${elapsed}s)`);
  text += theme.fg("dim", ` ${details.id}`);
  if (details.exitCode !== undefined) text += theme.fg("dim", ` exit ${details.exitCode}`);

  if (options.expanded) {
    const outputLines = renderOutput(details.output, theme);
    if (outputLines.length > 0) text += `\n${outputLines.join("\n")}`;
  }
  return new Text(text, 0, 0);
}

/** Compact render for a bash_task lookup or cancel call row. */
export function renderBashTaskCall(args: { id?: string; action?: string }, theme: Theme): Text {
  const id = args.id ?? "";
  const action = args.action ?? "status";
  return new Text(`${theme.fg("toolTitle", theme.bold("bash_task "))}${theme.fg("accent", id)} ${theme.fg("dim", action)}`, 0, 0);
}

/** Compact render for a bash_task lookup or cancel result row. */
export function renderBashTaskResult(details: BackgroundBashTask | { found: false; id: string; status: string }, options: { expanded: boolean }, theme: Theme): Text {
  if ("found" in details && details.found === false) {
    return new Text(theme.fg("error", `Task ${details.id} not found.`), 0, 0);
  }
  const task = details as BackgroundBashTask;
  const color = statusColor(task.status);
  let text = theme.fg(color, task.status);
  text += theme.fg("dim", ` ${task.id}`);
  if (task.exitCode !== undefined) text += theme.fg("dim", ` exit ${task.exitCode}`);

  if (options.expanded) {
    const outputLines = renderOutput(task.output, theme);
    if (outputLines.length > 0) text += `\n${outputLines.join("\n")}`;
  }
  return new Text(text, 0, 0);
}
