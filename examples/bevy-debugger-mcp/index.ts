// Machine-local installation from this repository:
// 1. Set `REPO_ROOT` to this repository and `PI_EXTENSIONS_DIR` to the machine-local extensions directory.
// 2. From `PI_EXTENSIONS_DIR`, run:
//    `npm pkg set dependencies.pi-extensions="file:$REPO_ROOT"`
//    `npm install`
// 3. Add `"pi-extensions/*": ["$REPO_ROOT/*"]` to tsconfig.json for typechecking/editing.
//    (Replace `$REPO_ROOT` with its absolute path; TypeScript does not expand shell variables.)
// 4. Link the complete example directory: `ln -s "$REPO_ROOT/examples/bevy-debugger-mcp" "$PI_EXTENSIONS_DIR/bevy-debugger-mcp"`.
//    Pi loads the provider from `bevy-debugger-mcp/index.ts`.
// The dependency exposes the reusable MCP utilities used below.
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { isCommandOnPath } from "./path.ts";
import type { McpToolProvider } from "pi-extensions/extensions/mcp/registry.ts";
import { StdioMcpClient, type SpawnMcpProcess, type StdioMcpTool } from "pi-extensions/extensions/mcp/stdio-client.ts";

export const BEVY_DEBUGGER_COMMAND = "bevy_brp_mcp";
export { isCommandOnPath } from "./path.ts";

function toPiTool(client: StdioMcpClient, tool: StdioMcpTool): ToolDefinition<any, any, any> {
  const name = `mcp__bevy_debugger__${tool.name}`;
  return {
    name,
    label: tool.name,
    description: tool.description ?? `Bevy debugger: ${tool.name}`,
    parameters: (tool.inputSchema ?? { type: "object", properties: {}, additionalProperties: false }) as never,
    async execute(_toolCallId, params) {
      const result = await client.call(tool.name, params);
      return {
        content: result?.content ?? [{ type: "text", text: JSON.stringify(result) }],
        details: { provider: "bevy_debugger" },
      };
    },
  };
}

export type BevyDebuggerProviderOptions = {
  command?: string;
  path?: string;
  spawnProcess?: SpawnMcpProcess;
};

function findDebuggerCommand(path?: string): string | undefined {
  return isCommandOnPath(BEVY_DEBUGGER_COMMAND, path) ? BEVY_DEBUGGER_COMMAND : undefined;
}

type BevyDebuggerProvider = McpToolProvider & { dispose(): void };

export function createBevyDebuggerProvider(options: BevyDebuggerProviderOptions = {}): BevyDebuggerProvider | undefined {
  const command = options.command ?? findDebuggerCommand(options.path);
  if (!command) return undefined;

  const client = new StdioMcpClient({ command, args: [], spawnProcess: options.spawnProcess });
  let status = "starting";
  let tools: ToolDefinition<any, any, any>[] = [];
  let loadError: string | undefined;
  let loadPromise: Promise<void> | undefined;

  const provider: McpToolProvider & { dispose(): void } = {
    id: "bevy_debugger",
    name: "Bevy Debugger MCP",
    tools,
    registerTools(register) {
      loadPromise = client.start().then((mcpTools) => {
        tools = mcpTools.map((tool) => toPiTool(client, tool));
        for (const piTool of tools) register(piTool);
        status = `ready (${tools.length} tools)`;
      }).catch((error: unknown) => {
        loadError = error instanceof Error ? error.message : String(error);
        status = "failed";
        client.close();
      });
    },
    async getStatusSections() {
      await loadPromise;
      return [{ title: "bevy_debugger_mcp", lines: [loadError ? `failed: ${loadError}` : status] }];
    },
    dispose() {
      client.close();
    },
  };
  return provider;
}

export function registerBevyDebuggerProvider(pi: ExtensionAPI, options: BevyDebuggerProviderOptions = {}): (() => void) | undefined {
  const provider = createBevyDebuggerProvider(options);
  if (!provider) return undefined;
  let active = true;
  const announce = () => {
    if (active) pi.events.emit("pi-mcp:provider-register", provider);
  };
  const stopReadyListener = pi.events.on("pi-mcp:registry-ready", announce);
  announce();
  return () => {
    if (!active) return;
    active = false;
    stopReadyListener();
    provider.dispose();
    pi.events.emit("pi-mcp:provider-unregister", provider);
  };
}

export default function bevyDebuggerMcpExtension(pi: ExtensionAPI, options: BevyDebuggerProviderOptions = {}): void {
  const stop = registerBevyDebuggerProvider(pi, options);
  if (stop) pi.on("session_shutdown", stop);
}
