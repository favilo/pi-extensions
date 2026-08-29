import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { getPublishedToolDefinitions, registerPublishedTool } from "../tool-registry/index.ts";
import { createBackgroundBashController, createNodeBashSpawn, type BackgroundBashSpawn, type BackgroundBashTask } from "./lifecycle.ts";
import { renderBackgroundBashLaunchCall, renderBackgroundBashLaunchResult, renderBashTaskCall, renderBashTaskResult, renderBackgroundBashMonitorMessage } from "./renderer.ts";

export type RegisterBackgroundBashOptions = {
  spawn?: BackgroundBashSpawn;
};

const backgroundParameterSchema = {
  type: "boolean",
  description: "Run this command in the background and return a task ID immediately instead of waiting for completion.",
} as const;

const monitorParameterSchema = {
  type: "boolean",
  description: "Wake the agent when monitored background output changes. Requires background: true.",
} as const;

/** Admit an optional background flag into the published bash tool's parameter schema. */
function withBackgroundParameter<T>(parameters: T): T {
  const schema = parameters as { type?: string; properties?: Record<string, unknown> };
  if (schema?.type !== "object" || !schema.properties) return parameters;
  return {
    ...schema,
    properties: {
      ...schema.properties,
      background: backgroundParameterSchema,
      monitor: monitorParameterSchema,
    },
  } as T;
}

/** Strip the renderer-owned background flag before delegating to the foreground executor. */
function withoutBackground<T>(params: T): T {
  if (!params || typeof params !== "object" || !("background" in params)) return params;
  const { background: _background, monitor: _monitor, ...rest } = params as Record<string, unknown>;
  return rest as T;
}

function monitorDeliveryOptions(ctx: unknown): { deliverAs: "steer"; triggerTurn: boolean } {
  const isIdle = (ctx as { isIdle?: () => boolean } | undefined)?.isIdle;
  return { deliverAs: "steer", triggerTurn: typeof isIdle !== "function" ? true : isIdle() };
}

/** Registers background-mode Bash launch plus task lookup/cancel tooling. */
export function registerBackgroundBash(pi: ExtensionAPI, options: RegisterBackgroundBashOptions = {}): void {
  const controller = createBackgroundBashController({ spawn: options.spawn ?? createNodeBashSpawn() });
  const bash = getPublishedToolDefinitions().find((tool) => tool.name === "bash");
  if (!bash) throw new Error("registerBackgroundBash requires the published bash tool definition.");

  function isBackgroundTaskDetails(details: unknown): details is BackgroundBashTask {
    return typeof details === "object" && details !== null && "status" in details && "id" in details && "command" in details;
  }

  registerPublishedTool(pi, {
    ...bash,
    parameters: withBackgroundParameter(bash.parameters),
    renderCall(args, theme, context) {
      const a = args as { background?: boolean; command?: string };
      if (a?.background === true) return renderBackgroundBashLaunchCall({ command: a.command, monitor: (args as { monitor?: boolean }).monitor }, theme);
      return bash.renderCall?.(args, theme, context) ?? new Text("", 0, 0);
    },
    renderResult(result, options, theme, context) {
      if (isBackgroundTaskDetails(result.details)) return renderBackgroundBashLaunchResult(result.details, options, theme);
      return bash.renderResult?.(result, options, theme, context) ?? new Text("", 0, 0);
    },
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const input = params as { command?: unknown; background?: unknown; monitor?: unknown; timeout?: unknown };
      if (input?.background !== true) {
        if (input?.monitor === true) throw new Error("monitor requires background: true.");
        return bash.execute(toolCallId, withoutBackground(params), signal, onUpdate, ctx);
      }
      if (typeof input.command !== "string" || !input.command.trim()) {
        throw new Error("Background bash requires a non-empty command string.");
      }
      const cwd = (ctx as { cwd?: string } | undefined)?.cwd ?? process.cwd();
      const sessionId = (ctx as { sessionId?: string; sessionManager?: { getSessionId(): string } })?.sessionId
        ?? (ctx as { sessionManager?: { getSessionId(): string } })?.sessionManager?.getSessionId();
      const outputDir = sessionId ? join(tmpdir(), "pi-bg-bash", sessionId) : undefined;
      let monitorMessages = 0;
      let monitorBytes = 0;
      let monitorWindowStartedAt = Date.now();
      let monitorWindowMessages = 0;
      let monitorOmitted = 0;
      let monitorOverflowNotified = false;
      const task = controller.launch({
        command: input.command,
        cwd,
        ...(typeof input.timeout === "number" ? { timeoutSeconds: input.timeout } : {}),
        ...(signal ? { signal } : {}),
        ...(outputDir ? { outputDir } : {}),
        ...(input.monitor === true
          ? {
              monitor: true,
              onMonitorEvent: (event: { stream: "stdout" | "stderr"; sequence: number; line: string }, taskId: string) => {
                const content = `task ${taskId} ${event.stream} [${event.sequence}..${event.sequence}]: ${event.line}`;
                const bytes = Buffer.byteLength(content, "utf8");
                const now = Date.now();
                if (now - monitorWindowStartedAt >= 1000) {
                  monitorWindowStartedAt = now;
                  monitorWindowMessages = 0;
                }
                if (monitorMessages >= 100 || monitorBytes + bytes > 32 * 1024 || monitorWindowMessages >= 20) {
                  monitorOmitted++;
                  if (!monitorOverflowNotified) {
                    monitorOverflowNotified = true;
                    pi.sendMessage({
                      customType: "background_bash_monitor",
                      content: `task ${taskId} monitor overflow: further output omitted`,
                      display: true,
                      details: { taskId, overflow: true, omitted: 1 },
                    }, monitorDeliveryOptions(ctx));
                  }
                  return;
                }
                monitorMessages++;
                monitorWindowMessages++;
                monitorBytes += bytes;
                pi.sendMessage({
                  customType: "background_bash_monitor",
                  content,
                  display: true,
                  details: {
                    taskId,
                    stream: event.stream,
                    fromSequence: event.sequence,
                    toSequence: event.sequence,
                    lines: [event.line],
                  },
                }, monitorDeliveryOptions(ctx));
              },
              onMonitorComplete: (completed: BackgroundBashTask) => {
                pi.sendMessage({
                  customType: "background_bash_monitor",
                  content: `task ${completed.id} completed with status ${completed.status}`,
                  display: true,
                  details: {
                    taskId: completed.id,
                    terminal: true,
                    status: completed.status,
                    exitCode: completed.exitCode,
                    signal: completed.signal,
                    omitted: monitorOmitted,
                  },
                }, monitorDeliveryOptions(ctx));
              },
            }
          : {}),
      });
      const paths = [
        ...(task.stdoutPath ? [`stdout: ${task.stdoutPath}`] : []),
        ...(task.stderrPath ? [`stderr: ${task.stderrPath}`] : []),
      ];
      return {
        content: [{ type: "text" as const, text: `Background task ${task.id} started (status: ${task.status}).${paths.length ? `\n${paths.join("\n")}` : ""}` }],
        details: task,
      };
    },
  });

  registerPublishedTool(pi, {
    name: "bash_task",
    label: "bash_task",
    description: "Manage background Bash tasks. Use action: \"list\", \"status\", \"output\", \"stop_monitor\", or \"cancel\". Output supports bounded stream, offset, and limit retrieval.",
    parameters: Type.Object({
      id: Type.Optional(Type.String({ description: "The background task ID returned by a background bash launch; required except for list." })),
      action: Type.Optional(Type.String({ description: "\"list\", \"status\" (default), \"output\", \"stop_monitor\", or \"cancel\"." })),
      stream: Type.Optional(Type.String({ description: "For output: stdout or stderr (default: both)." })),
      offset: Type.Optional(Type.Integer({ description: "For output: zero-based line offset." })),
      limit: Type.Optional(Type.Integer({ description: "For output: maximum lines to return, capped at 1000." })),
    }),
    renderCall(args, theme) {
      return renderBashTaskCall({ id: args?.id, action: args?.action }, theme);
    },
    renderResult(result, options, theme) {
      return renderBashTaskResult(result.details as never, options, theme);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const id = params.id;
      const action = params.action ?? "status";
      if (action === "list") {
        const tasks = controller.list();
        return { content: [{ type: "text" as const, text: JSON.stringify(tasks, null, 2) }], details: { tasks } };
      }
      if (!id) throw new Error(`Action ${action} requires a task ID.`);
      if (action === "output") {
        const task = controller.status(id);
        if (!task) return { content: [{ type: "text" as const, text: `Task ${id} not found.` }], details: { found: false, id, status: "unknown" } };
        const stream = params.stream === "stdout" || params.stream === "stderr" ? params.stream : undefined;
        const offset = Math.max(0, params.offset ?? 0);
        const limit = Math.min(1000, Math.max(1, params.limit ?? 100));
        const selected = stream ? { [stream]: task.output?.[stream] } : { stdout: task.output?.stdout, stderr: task.output?.stderr };
        const output = Object.fromEntries(Object.entries(selected).map(([name, value]) => {
          const lines = value?.text ? value.text.split("\n").filter((line, index, all) => index < all.length - 1 || line.length > 0) : [];
          return [name, { lines: lines.slice(offset, offset + limit), offset, limit, totalLines: value?.totalLines ?? 0, nextOffset: Math.min(offset + limit, lines.length) }];
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }], details: { found: true, id, output } };
      }
      if (action === "stop_monitor") {
        const status = controller.status(id);
        if (!status) {
          return { content: [{ type: "text" as const, text: `Task ${id} not found.` }], details: { found: false, id, status: "unknown" } };
        }
        const stopped = controller.stopMonitor(id);
        return {
          content: [{ type: "text" as const, text: stopped ? `Monitor for task ${id} stopped.` : `Task ${id} has no active monitor.` }],
          details: { ...status, monitor: stopped ? "stopped" : "inactive" },
        };
      }
      if (action === "cancel") {
        const cancelled = controller.cancel(id);
        if (!cancelled) {
          return { content: [{ type: "text" as const, text: `Task ${id} not found.` }], details: { found: false, id, status: "unknown" } };
        }
        return { content: [{ type: "text" as const, text: `Task ${id} cancelled.` }], details: cancelled };
      }
      const status = controller.status(id);
      if (!status) {
        return { content: [{ type: "text" as const, text: `Task ${id} not found.` }], details: { found: false, id, status: "unknown" } };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }], details: status };
    },
  });

  if (typeof pi.registerMessageRenderer === "function") {
    pi.registerMessageRenderer("background_bash_monitor", (message, renderOptions, theme) =>
      renderBackgroundBashMonitorMessage({ content: String(message.content) }, renderOptions, theme));
  }

  if (typeof pi.on === "function") {
    pi.on("session_shutdown", () => {
      controller.close();
    });
  }
}
