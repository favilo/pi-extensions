import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type McpProviderTool = ToolDefinition<any, any, any>;

export type McpProviderStatusSection = {
  title: string;
  lines: string[];
};

export type McpToolProvider = {
  id: string;
  name: string;
  tools: McpProviderTool[];
  registerTools?(register: (tool: McpProviderTool) => void): void;
  getStatusSections(): Promise<McpProviderStatusSection[]> | McpProviderStatusSection[];
};

export type McpRegistryStatusSection = McpProviderStatusSection & {
  providerId: string;
  providerName: string;
};

export type McpProviderRegistrationResult =
  | { ok: true }
  | { ok: false; error: string };

export class McpProviderRegistry {
  private readonly providers = new Map<string, McpToolProvider>();
  private readonly providerFailures = new Map<McpToolProvider, string>();
  private readonly providerToolNames = new Map<string, Set<string>>();
  private readonly toolOwners = new Map<string, string>();
  private readonly registerTool: (tool: McpProviderTool) => void;

  constructor(registerTool: (tool: McpProviderTool) => void) {
    this.registerTool = registerTool;
  }

  register(provider: McpToolProvider): McpProviderRegistrationResult {
    const existing = this.providers.get(provider.id);
    if (existing === provider) return { ok: true };
    if (existing) {
      this.providerFailures.set(provider, provider.name);
      return { ok: false, error: `MCP provider already registered: ${provider.id}` };
    }

    if (provider.tools.some((tool) => this.toolOwners.has(tool.name))) {
      this.providerFailures.set(provider, provider.name);
      return { ok: false, error: `MCP provider failed to register: ${provider.id}` };
    }

    this.providers.set(provider.id, provider);
    this.providerFailures.delete(provider);
    this.providerToolNames.set(provider.id, new Set());
    const contributeTool = (tool: McpProviderTool) => this.registerProviderTool(provider.id, tool);
    try {
      for (const tool of provider.tools) contributeTool(tool);
      provider.registerTools?.(contributeTool);
      return { ok: true };
    } catch {
      this.unregister(provider);
      this.providerFailures.set(provider, provider.name);
      return { ok: false, error: `MCP provider failed to register: ${provider.id}` };
    }
  }

  unregister(provider: McpToolProvider): string[] {
    this.providerFailures.delete(provider);
    if (this.providers.get(provider.id) !== provider) return [];

    const toolNames = [...(this.providerToolNames.get(provider.id) ?? [])];
    for (const toolName of toolNames) {
      if (this.toolOwners.get(toolName) === provider.id) this.toolOwners.delete(toolName);
    }
    this.providerToolNames.delete(provider.id);
    this.providers.delete(provider.id);
    return toolNames;
  }

  unregisterAll(): string[] {
    const toolNames = [...this.providers.values()].flatMap((provider) => this.unregister(provider));
    this.providerFailures.clear();
    return toolNames;
  }

  async getStatusSections(): Promise<McpRegistryStatusSection[]> {
    const sections: McpRegistryStatusSection[] = [];
    for (const [provider, providerName] of this.providerFailures) {
      sections.push(this.failureSection(provider.id, providerName));
    }
    for (const provider of this.providers.values()) {
      try {
        const providerSections = await provider.getStatusSections();
        sections.push(
          ...providerSections.map((section) => ({
            providerId: provider.id,
            providerName: provider.name,
            ...section,
          })),
        );
      } catch {
        sections.push(this.failureSection(provider.id, provider.name));
      }
    }
    return sections;
  }

  private failureSection(providerId: string, providerName: string): McpRegistryStatusSection {
    return {
      providerId,
      providerName,
      title: "Provider failure",
      lines: ["status unavailable"],
    };
  }

  private registerProviderTool(providerId: string, tool: McpProviderTool): void {
    const toolNames = this.providerToolNames.get(providerId);
    if (!toolNames || toolNames.has(tool.name)) return;
    const owner = this.toolOwners.get(tool.name);
    if (owner && owner !== providerId) throw new Error(`MCP tool already registered: ${tool.name}`);
    this.registerTool(tool);
    this.toolOwners.set(tool.name, providerId);
    toolNames.add(tool.name);
  }
}
