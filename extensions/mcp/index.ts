import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  McpProviderRegistry,
  type McpRegistryStatusSection,
  type McpToolProvider,
} from "./registry.ts";

export type {
  McpProviderStatusSection,
  McpProviderTool,
  McpToolProvider,
} from "./registry.ts";
export { StdioMcpClient } from "./stdio-client.ts";
export type { SpawnMcpProcess, StdioMcpTool } from "./stdio-client.ts";

const PROVIDER_REGISTER_CHANNEL = "pi-mcp:provider-register";
const PROVIDER_UNREGISTER_CHANNEL = "pi-mcp:provider-unregister";
const REGISTRY_READY_CHANNEL = "pi-mcp:registry-ready";

function formatSections(sections: McpRegistryStatusSection[]): string {
  if (sections.length === 0) return "MCP providers: none registered";

  const lines: string[] = ["MCP providers:"];
  let previousProvider: string | undefined;
  for (const section of sections) {
    const providerKey = `${section.providerId}\u0000${section.providerName}`;
    if (providerKey !== previousProvider) {
      lines.push(``, section.providerName);
      previousProvider = providerKey;
    }
    lines.push(`- ${section.title}`, ...section.lines.map((line) => `  ${line}`));
  }
  return lines.join("\n");
}

export function registerMcpProvider(pi: ExtensionAPI, provider: McpToolProvider): () => void {
  let active = true;
  const announce = () => {
    if (active) pi.events.emit(PROVIDER_REGISTER_CHANNEL, provider);
  };
  const stopReadyListener = pi.events.on(REGISTRY_READY_CHANNEL, announce);
  announce();

  return () => {
    if (!active) return;
    active = false;
    stopReadyListener();
    pi.events.emit(PROVIDER_UNREGISTER_CHANNEL, provider);
  };
}

export default function mcpExtension(pi: ExtensionAPI) {
  const registry = new McpProviderRegistry((tool) => pi.registerTool(tool));
  const stopRegistrationListener = pi.events.on(PROVIDER_REGISTER_CHANNEL, (data) => {
    registry.register(data as McpToolProvider);
  });
  const stopUnregistrationListener = pi.events.on(PROVIDER_UNREGISTER_CHANNEL, (data) => {
    if (!data || typeof data !== "object") return;
    const removedTools = new Set(registry.unregister(data as McpToolProvider));
    pi.setActiveTools(pi.getActiveTools().filter((name) => !removedTools.has(name)));
  });

  pi.registerCommand("mcp", {
    description: "Show MCP provider status",
    handler: async () => {
      const sections = await registry.getStatusSections();
      pi.sendMessage({
        customType: "pi-mcp-status",
        content: formatSections(sections),
        display: true,
      });
    },
  });

  pi.on("session_shutdown", () => {
    const removedTools = new Set(registry.unregisterAll());
    pi.setActiveTools(pi.getActiveTools().filter((name) => !removedTools.has(name)));
    stopRegistrationListener();
    stopUnregistrationListener();
  });

  pi.events.emit(REGISTRY_READY_CHANNEL, undefined);
}
