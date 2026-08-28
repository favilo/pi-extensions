import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getPublishedToolDefinitions, registerPublishedTool } from "../tool-registry/index.ts";
import { createBackgroundBashController, createNodeBashSpawn, type BackgroundBashSpawn } from "./lifecycle.ts";

export type RegisterBackgroundBashOptions = {
  spawn?: BackgroundBashSpawn;
};

const backgroundParameterSchema = {
  type: "boolean",
  description: "Run this command in the background and return a task ID immediately instead of waiting for completion.",
} as const;

/** Admit an optional background flag into the published bash tool's parameter schema. */
function withBackgroundParameter<T>(parameters: T): T {
  const schema = parameters as { type?: string; properties?: Record<string, unknown> };
  if (schema?.type !== "object" || !schema.properties) return parameters;
  return { ...schema, properties: { ...schema.properties, background: backgroundParameterSchema } } as T;
}

/** Strip the renderer-owned background flag before delegating to the foreground executor. */
function withoutBackground<T>(params: T): T {
  if (!params || typeof params !== "object" || !("background" in params)) return params;
  const { background: _background, ...rest } = params as Record<string, unknown>;
  return rest as T;
}

/** Registers background-mode Bash launch plus task lookup/cancel tooling. */
export function registerBackgroundBash(pi: ExtensionAPI, options: RegisterBackgroundBashOptions = {}): void {
  const controller = createBackgroundBashController({ spawn: options.spawn ?? createNodeBashSpawn() });
  const bash = getPublishedToolDefinitions().find((tool) => tool.name === "bash");
  if (!bash) throw new Error("registerBackgroundBash requires the published bash tool definition.");

  registerPublishedTool(pi, {
    ...bash,
    parameters: withBackgroundParameter(bash.parameters),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      const input = params as { command?: unknown; background?: unknown; timeout?: unknown };
      if (input?.background !== true) {
        return bash.execute(toolCallId, withoutBackground(params), signal, onUpdate, ctx);
      }
      if (typeof input.command !== "string" || !input.command.trim()) {
        throw new Error("Background bash requires a non-empty command string.");
      }
      const cwd = (ctx as { cwd?: string } | undefined)?.cwd ?? process.cwd();
      const task = controller.launch({
        command: input.command,
        cwd,
        ...(typeof input.timeout === "number" ? { timeoutSeconds: input.timeout } : {}),
        ...(signal ? { signal } : {}),
      });
      return {
        content: [{ type: "text" as const, text: `Background task ${task.id} started (status: ${task.status}).` }],
        details: task,
      };
    },
  });

  pi.on("session_shutdown", () => {
    controller.close();
  });
}
