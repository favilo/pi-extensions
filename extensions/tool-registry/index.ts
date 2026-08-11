import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

export type RegisteredToolDefinition = ToolDefinition<any, any, any>;

const tools = new Map<string, RegisteredToolDefinition>();

export function publishToolDefinition(tool: RegisteredToolDefinition): void {
  tools.set(tool.name, tool);
}

export function unpublishToolDefinition(name: string): void {
  tools.delete(name);
}

export function getPublishedToolDefinitions(): RegisteredToolDefinition[] {
  return [...tools.values()];
}

/** Register a tool with Pi and make its callable definition available to subagents. */
export function registerPublishedTool<TParams extends ToolDefinition["parameters"], TDetails, TState>(
  pi: ExtensionAPI,
  tool: ToolDefinition<TParams, TDetails, TState>,
): void {
  publishToolDefinition(tool);
  pi.registerTool(tool);
}
