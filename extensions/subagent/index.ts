import { Compile } from "typebox/compile";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  highlightCode,
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getPublishedToolDefinitions } from "../tool-registry/index.ts";
import { createToolPermissionBoundary, logSubagentDebug, promptToolPermissionRequest, type PermissionContext } from "../tool-permissions/index.ts";
import type { ToolPermissionBoundary } from "../tool-permissions/permission-boundary.ts";
import { createSubagentSession, executeChildToolRequest, resolveSubagentCwd } from "./agent-session.ts";
import { createChildSessionWithRuntime } from "./account-runtime.ts";
import {
  createBackgroundSessionController,
  type BackgroundResult,
  type BackgroundSessionController,
} from "./background-lifecycle.ts";
import { createCompletionSignalDispatcher } from "./completion-delivery.ts";
import { subagentResultDisplay } from "./result-renderer.ts";

const subagentParameters = {
  type: "object",
  properties: {
    task: { type: "string", description: "The task for the child agent." },
    agent: { type: "string", description: "A stable short name for the child agent." },
    cwd: { type: "string", description: "Child working directory, relative to the parent cwd." },
    account: { type: "string", description: "Optional account-switcher account ID for the child runtime." },
    model: { type: "string", description: "Optional child model in provider/model-id format." },
  },
  required: ["task"],
  additionalProperties: false,
} as never;
type SubagentParameters = { task: string; agent?: string; cwd?: string; account?: string; model?: string };

const subagentResultParameters = {
  type: "object",
  properties: {
    id: { type: "string", description: "The generated background child task ID." },
    full_context: { type: "string", description: "Optional destination file path to export the complete versioned JSON snapshot." },
    overwrite: { type: "boolean", description: "Optional flag to allow overwriting an existing regular file destination." },
  },
  required: ["id"],
  additionalProperties: false,
} as never;
type SubagentResultParameters = { id: string; full_context?: string; overwrite?: boolean };

/** Normal tools available to the parent-side permission executor. */
function normalToolDefinitions(cwd: string): ToolDefinition[] {
  const builtins = [
    createReadToolDefinition(cwd),
    createWriteToolDefinition(cwd),
    createEditToolDefinition(cwd),
    createBashToolDefinition(cwd),
    createGrepToolDefinition(cwd),
    createFindToolDefinition(cwd),
    createLsToolDefinition(cwd),
  ] as unknown as ToolDefinition[];
  const definitions = new Map<string, ToolDefinition>();
  for (const tool of [...builtins, ...getPublishedToolDefinitions()]) definitions.set(tool.name, tool);
  return [...definitions.values()];
}

const childToolRequestParameters = {
  type: "object",
  properties: {
    toolName: { type: "string", description: "The exact parent tool name to request." },
    input: {
      type: "object",
      additionalProperties: true,
      description: "The arguments object for the requested tool; pass JSON fields directly, not a JSON-encoded string.",
    },
  },
  required: ["toolName", "input"],
  additionalProperties: false,
} as never;
type ChildToolRequestParameters = { toolName: string; input: unknown };

/** Exposes only the permission bridge to the child model. */
export function createChildToolDefinitions(
  childId: string,
  cwd: string,
  boundary: ReturnType<typeof createToolPermissionBoundary>,
): ToolDefinition[] {
  return [{
    name: "subagent-tool-request",
    label: "subagent-tool-request",
    description: "Request that the parent agent authorize and execute a tool call on your behalf.",
    parameters: childToolRequestParameters,
    async execute(_toolCallId, input: ChildToolRequestParameters, signal) {
      logSubagentDebug("child-tool-request-start", { childId, toolName: input.toolName, cwd });
      const result = await executeChildToolRequest({
        childId,
        toolName: input.toolName,
        input: input.input,
        cwd,
      }, boundary, signal);
      logSubagentDebug("child-tool-request-result", { childId, toolName: input.toolName, status: result.status });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  }];
}

export function createParentPermissionPrompt(
  pi: Pick<ExtensionAPI, "sendUserMessage">,
  childId: string,
  parentContext: PermissionContext,
  setStatus: (status: "running" | "waiting-for-permission") => void = () => {},
): ToolPermissionBoundary["prompt"] {
  if (!parentContext.hasUI) return undefined;

  return async (request, signal) => {
    setStatus("waiting-for-permission");
    logSubagentDebug("boundary-prompt", { request, parentMode: parentContext.mode, parentHasUI: parentContext.hasUI });
    parentContext.ui.notify?.(`Subagent ${childId} → ${request.toolName}: permission required`, "info");
    try {
      return await promptToolPermissionRequest(pi, { ...parentContext, signal }, request);
    } finally {
      setStatus("running");
    }
  };
}

function executeParentTool(
  pi: ExtensionAPI,
  cwd: string,
  parentContext: ExtensionContext,
  params: SubagentParameters,
  invocationSignal: AbortSignal | undefined,
  controller: BackgroundSessionController,
) {
  const tools = Object.fromEntries(normalToolDefinitions(cwd).map((tool) => [tool.name, tool]));
  const parentSessionDir = parentContext.sessionManager.getSessionFile()
    ? parentContext.sessionManager.getSessionDir()
    : undefined;
  const toolCatalog = normalToolDefinitions(cwd).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  return controller.launch({
    cwd,
    parentContext: `${parentContext.getSystemPrompt()}\n\nYou are a background subagent. Child tool policy: you have only the subagent-tool-request tool. For every file, shell, search, MCP, or other tool action, call it with the exact toolName and an input object. Put arguments directly in that object (for example, input: {"command":"pwd"}), never as a JSON-encoded string. Do not attempt to call tools directly, and do not ask the main agent to repeat or duplicate your requested action. Tool permission UI and activity are attributed to your generated subagent ID.\n\nAvailable parent tools and input schemas:\n${JSON.stringify(toolCatalog)}`,
    task: params.task,
    invocationSignal,
    createSession: async ({ childId, cwd: childCwd, signal }) => {
      const boundary = createToolPermissionBoundary({
        validate: (request) => {
          const tool = tools[request.toolName as keyof typeof tools];
          if (!tool) return `Unknown tool: ${request.toolName}`;
          try {
            const validator = Compile(tool.parameters as never);
            return validator.Check(request.input)
              ? undefined
              : `Invalid input for ${request.toolName}; arguments do not match the published tool schema.`;
          } catch (error) {
            return `Could not validate input for ${request.toolName}: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
        prompt: createParentPermissionPrompt(
          pi,
          childId,
          parentContext,
          (status) => { controller.setStatus(childId, status); },
        ),
        execute: async (request) => {
          const tool = tools[request.toolName as keyof typeof tools];
          if (!tool) throw new Error(`Unknown child tool: ${request.toolName}`);
          return tool.execute(childId, request.input as never, signal, undefined, parentContext);
        },
      });
      const session = await createChildSessionWithRuntime(params, async (childRuntime) =>
        createSubagentSession(childCwd, {
          customTools: createChildToolDefinitions(childId, childCwd, boundary),
          sessionManager: parentSessionDir ? SessionManager.create(childCwd, parentSessionDir) : undefined,
          ...(childRuntime ? { modelRuntime: childRuntime.modelRuntime, model: childRuntime.model } : {}),
        }),
      );
      logSubagentDebug("child-session-created", { childId, cwd: childCwd, activeTools: session.getActiveToolNames?.() });
      return session;
    },
  });
}

export default function subagentExtension(pi: ExtensionAPI): void {
  const completionSignals = createCompletionSignalDispatcher(
    (message, options) => pi.sendMessage(message, options),
    (event, details) => logSubagentDebug(event, details),
  );
  const controller = createBackgroundSessionController(
    async () => { throw new Error("Background child session factory was not supplied by the launch request."); },
    {
      notify: (message, options) => completionSignals.notify(message, options),
      debug: (event, details) => logSubagentDebug(event, details),
    },
  );

  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description: "Launch a permission-enforced child in the background and return its generated task ID. Use account and model directly for this launch; do not call set_subagent_account when an explicit child account is requested.",
    promptSnippet: "Launch a permission-enforced background child with optional account/model selection.",
    promptGuidelines: [
      "When a child needs a specific account or model, pass account and model directly to subagent in the same call.",
      "Do not call set_subagent_account before an explicit subagent account/model launch; it is only for legacy inherited selection.",
      "The single subagent approval covers its selected runtime; each later child tool action is approved separately.",
    ],
    parameters: subagentParameters,
    async execute(_toolCallId, params: SubagentParameters, signal, _onUpdate, ctx) {
      const cwd = resolveSubagentCwd(ctx.cwd, params.cwd);
      const result = await executeParentTool(pi, cwd, ctx, params, signal, controller);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "subagent_result",
    label: "subagent_result",
    description: "Retrieve current status and bounded output for a background child owned by this parent session.",
    parameters: subagentResultParameters,
    async execute(_toolCallId, params: SubagentResultParameters, signal) {
      if (typeof params.full_context === "string" && params.full_context.length > 0) {
        const exportResult = await controller.exportResult(params.id, {
          destinationPath: params.full_context,
          overwrite: params.overwrite,
          signal,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(exportResult) }],
          details: exportResult,
        };
      }
      const result = controller.result(params.id);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
    renderCall(args: SubagentResultParameters, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("subagent_result ")) + theme.fg("accent", args.id),
        0,
        0,
      );
    },
    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg("warning", "Retrieving..."), 0, 0);
      const details = result.details as BackgroundResult | undefined;
      if (!details) {
        const content = result.content[0];
        return new Text(content?.type === "text" ? content.text : "No result", 0, 0);
      }

      const display = subagentResultDisplay(details, expanded);
      const statusColor = !details.found
        ? "warning"
        : details.status === "completed"
          ? "success"
          : details.status === "failed" || details.status === "cancelled"
            ? "error"
            : "accent";
      let text = theme.fg(statusColor, display.summary);
      if (display.expandedJson) text += `\n${highlightCode(display.expandedJson, "json").join("\n")}`;
      return new Text(text, 0, 0);
    },
  });

  pi.on("message_start", (event) => {
    completionSignals.observeMessage(event.message);
  });

  pi.on("agent_settled", () => {
    completionSignals.parentSettled();
  });

  pi.on("session_shutdown", async () => {
    completionSignals.close();
    await controller.close();
  });
}
