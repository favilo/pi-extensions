import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  type ExtensionContext,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getPublishedToolDefinitions } from "../tool-registry/index.ts";
import { createToolPermissionBoundary, promptToolPermissionRequest } from "../tool-permissions/index.ts";
import { createSubagentSession, executeChildToolRequest, runSubagentSession } from "./agent-session.ts";

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

/**
 * Wraps each normal coding-agent tool for a child AgentSession.
 *
 * The child session starts with `noTools: "all"`, then receives these
 * definitions as its complete tool surface. Each wrapper preserves the
 * normal tool name and schema, but sends execution through the parent's
 * shared permission boundary before invoking the underlying implementation.
 * Skills therefore see ordinary tools without gaining an authorization bypass.
 */
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

export function createChildToolDefinitions(
  childId: string,
  cwd: string,
  boundary: ReturnType<typeof createToolPermissionBoundary>,
): ToolDefinition[] {
  const tools = normalToolDefinitions(cwd);
  return tools.map((tool): ToolDefinition => ({
    ...tool,
    async execute(toolCallId, input, signal, onUpdate) {
      const result = await executeChildToolRequest({
        childId,
        toolName: tool.name,
        input,
        cwd,
      }, boundary, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  }));
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
    prompt: async (request) => {
      pi.sendMessage({
        customType: "subagent-tool-request",
        content: `Subagent "${childId}" requests ${request.toolName}`,
        display: true,
        details: request,
      });
      return promptToolPermissionRequest(pi, parentContext, request);
    },
    execute: async (request) => {
      const tool = tools[request.toolName as keyof typeof tools];
      if (!tool) throw new Error(`Unknown child tool: ${request.toolName}`);
      return tool.execute(childId, request.input as never, signal, undefined, parentContext);
    },
  });

  return runSubagentSession({
    cwd,
    parentContext: parentContext.getSystemPrompt(),
    task: params.task,
    signal,
    createSession: async ({ cwd: childCwd }) => createSubagentSession(
      childCwd,
      { customTools: createChildToolDefinitions(childId, childCwd, boundary) },
    ),
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
      const cwd = params.cwd ? new URL(params.cwd, `file://${ctx.cwd}/`).pathname : ctx.cwd;
      const result = await executeParentTool(pi, cwd, childId, ctx, params, signal);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
