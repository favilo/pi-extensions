import { Compile } from "typebox/compile";
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  SessionManager,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getPublishedToolDefinitions } from "../tool-registry/index.ts";
import { createToolPermissionBoundary, logSubagentDebug, promptToolPermissionRequest, type PermissionContext } from "../tool-permissions/index.ts";
import type { ToolPermissionBoundary } from "../tool-permissions/permission-boundary.ts";
import { createSubagentSession, executeChildToolRequest, resolveSubagentCwd } from "./agent-session.ts";
import { createBackgroundSessionController, type BackgroundSessionController } from "./background-lifecycle.ts";

const subagentParameters = {
  type: "object",
  properties: {
    task: { type: "string", description: "The task for the child agent." },
    agent: { type: "string", description: "A stable short name for the child agent." },
    cwd: { type: "string", description: "Child working directory, relative to the parent cwd." },
  },
  required: ["task"],
  additionalProperties: false,
} as never;
type SubagentParameters = { task: string; agent?: string; cwd?: string };

const subagentResultParameters = {
  type: "object",
  properties: {
    id: { type: "string", description: "The generated background child task ID." },
  },
  required: ["id"],
  additionalProperties: false,
} as never;
type SubagentResultParameters = { id: string };

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
    input: { description: "The arguments for the requested tool." },
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
    parentContext: `${parentContext.getSystemPrompt()}\n\nYou are a background subagent. Child tool policy: you have only the subagent-tool-request tool. For every file, shell, search, MCP, or other tool action, call it with the exact toolName and JSON input. Do not attempt to call tools directly, and do not ask the main agent to repeat or duplicate your requested action. Tool permission UI and activity are attributed to your generated subagent ID.\n\nAvailable parent tools and input schemas:\n${JSON.stringify(toolCatalog)}`,
    task: params.task,
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
      const session = await createSubagentSession(childCwd, {
        customTools: createChildToolDefinitions(childId, childCwd, boundary),
        sessionManager: parentSessionDir ? SessionManager.create(childCwd, parentSessionDir) : undefined,
      });
      logSubagentDebug("child-session-created", { childId, cwd: childCwd, activeTools: session.getActiveToolNames?.() });
      return session;
    },
  });
}

export default function subagentExtension(pi: ExtensionAPI): void {
  const controller = createBackgroundSessionController(
    async () => { throw new Error("Background child session factory was not supplied by the launch request."); },
    {
      notify: (message, options) => pi.sendMessage(message, options),
      debug: (event, details) => logSubagentDebug(event, details),
    },
  );

  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description: "Launch a permission-enforced child in the background and return its generated task ID.",
    parameters: subagentParameters,
    async execute(_toolCallId, params: SubagentParameters, _signal, _onUpdate, ctx) {
      const cwd = resolveSubagentCwd(ctx.cwd, params.cwd);
      const result = await executeParentTool(pi, cwd, ctx, params, controller);
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
    async execute(_toolCallId, params: SubagentResultParameters) {
      const result = controller.result(params.id);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });

  pi.on("session_shutdown", async () => {
    await controller.close();
  });
}
