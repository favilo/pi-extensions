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
import { createSubagentSession, executeChildToolRequest, resolveSubagentCwd, runSubagentSession } from "./agent-session.ts";

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
      const result = await executeChildToolRequest({
        childId,
        toolName: input.toolName,
        input: input.input,
        cwd,
      }, boundary, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  }];
}

export function createParentPermissionPrompt(
  pi: Pick<ExtensionAPI, "sendMessage" | "sendUserMessage">,
  childId: string,
  parentContext: PermissionContext,
): ToolPermissionBoundary["prompt"] {
  if (!parentContext.hasUI) return undefined;

  return async (request) => {
    logSubagentDebug("boundary-prompt", { request, parentMode: parentContext.mode, parentHasUI: parentContext.hasUI });
    pi.sendMessage({
      customType: "subagent-tool-request",
      content: `Subagent "${childId}" requests ${request.toolName}`,
      display: true,
      details: request,
    });
    return promptToolPermissionRequest(pi, parentContext, request);
  };
}

function executeParentTool(
  pi: ExtensionAPI,
  cwd: string,
  childId: string,
  parentContext: ExtensionContext,
  params: SubagentParameters,
  signal: AbortSignal | undefined,
) {
  const tools = Object.fromEntries(normalToolDefinitions(cwd).map((tool) => [tool.name, tool]));
  const boundary = createToolPermissionBoundary({
    validate: (request) => {
      logSubagentDebug("boundary-validate", { request, availableTools: Object.keys(tools) });
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
    prompt: createParentPermissionPrompt(pi, childId, parentContext),
    execute: async (request) => {
      logSubagentDebug("boundary-execute", { request });
      const tool = tools[request.toolName as keyof typeof tools];
      if (!tool) throw new Error(`Unknown child tool: ${request.toolName}`);
      return tool.execute(childId, request.input as never, signal, undefined, parentContext);
    },
  });

  const parentSessionDir = parentContext.sessionManager.getSessionFile()
    ? parentContext.sessionManager.getSessionDir()
    : undefined;
  const toolCatalog = normalToolDefinitions(cwd).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));

  return runSubagentSession({
    cwd,
    parentContext: `${parentContext.getSystemPrompt()}\n\nChild tool policy: you have only the subagent-tool-request tool. For every file, shell, search, MCP, or other tool action, call it with the exact toolName and JSON input. Do not attempt to call tools directly.\n\nAvailable parent tools and input schemas:\n${JSON.stringify(toolCatalog)}`, 
    task: params.task,
    signal,
    createSession: async ({ cwd: childCwd }) => {
      const session = await createSubagentSession(childCwd, {
        customTools: createChildToolDefinitions(childId, childCwd, boundary),
        sessionManager: parentSessionDir ? SessionManager.create(childCwd, parentSessionDir) : undefined,
      });
      logSubagentDebug("child-session-created", {
        childId,
        cwd: childCwd,
        activeTools: session.getActiveToolNames?.(),
      });
      return session;
    },
  });
}

export default function subagentExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "subagent",
    label: "subagent",
    description: "Launch a child agent whose tool requests remain subject to the parent permission policy.",
    parameters: subagentParameters,
    async execute(_toolCallId, params: SubagentParameters, signal, _onUpdate, ctx) {
      const childId = params.agent?.trim() || "child-agent";
      const cwd = resolveSubagentCwd(ctx.cwd, params.cwd);
      const result = await executeParentTool(pi, cwd, childId, ctx, params, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
