import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";

// These event names are the public wire contract. A machine-local provider should not import
// the registry implementation because installed package paths differ across computers.
const PROVIDER_REGISTER_CHANNEL = "pi-mcp:provider-register";
const PROVIDER_UNREGISTER_CHANNEL = "pi-mcp:provider-unregister";
const REGISTRY_READY_CHANNEL = "pi-mcp:registry-ready";

type McpStatusSection = {
  title: string;
  lines: string[];
};

type McpToolProvider = {
  id: string;
  name: string;
  tools: ToolDefinition<any, any, any>[];
  getStatusSections(): McpStatusSection[] | Promise<McpStatusSection[]>;
};

const provider: McpToolProvider = {
  id: "example",
  name: "Example MCP provider",
  tools: [
    {
      name: "mcp__example__echo",
      label: "Example echo",
      description: "Echo text through the self-contained example MCP provider",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      } as never,
      async execute(_toolCallId, params) {
        const { text } = params as { text: string };
        return {
          content: [{ type: "text", text: `mock: ${text}` }],
          details: { provider: "example" },
        };
      },
    },
  ],
  getStatusSections() {
    // Providers own section content so the shared registry never needs provider-specific logic.
    return [
      { title: "Example healthy server", lines: ["ready", "tools: echo"] },
      { title: "Example failed server", lines: ["failed: simulated connection error"] },
    ];
  },
};

export default function exampleMcpProvider(pi: ExtensionAPI) {
  let active = true;
  const announce = () => {
    if (active) pi.events.emit(PROVIDER_REGISTER_CHANNEL, provider);
  };

  // Listen for registry readiness and also announce immediately so either extension may load first.
  const stopReadyListener = pi.events.on(REGISTRY_READY_CHANNEL, announce);
  announce();

  pi.on("session_shutdown", () => {
    if (!active) return;
    active = false;
    stopReadyListener();
    // Explicit removal prevents stale provider state when Pi reloads or replaces the session.
    pi.events.emit(PROVIDER_UNREGISTER_CHANNEL, provider);
  });
}
