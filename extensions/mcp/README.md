# MCP provider registry

This extension gives Pi one provider-neutral `/mcp` command and one registry for MCP tool providers. Providers remain independent extensions: they own transport, authentication, configuration, tool execution, and status wording.

The registry intentionally knows nothing about Codex or any other provider.

## Start from the example

Copy [`examples/mcp-provider/index.ts`](../../examples/mcp-provider/index.ts) into your machine-local Pi extensions directory and rename its provider, tools, and status sections:

```bash
cp examples/mcp-provider/index.ts ~/.pi/agent/extensions/my-mcp-provider.ts
```

The example is self-contained. It requires no credentials, network access, configuration, or MCP server. It also deliberately does **not** import this registry implementation, so it mirrors how a machine-local provider works when this package is installed elsewhere.

## Architecture

Two independently loaded extensions communicate through Pi's shared event bus:

1. The registry listens for provider registrations.
2. A provider announces itself immediately.
3. The provider also listens for registry readiness and announces again if the registry loaded later.
4. Registration is idempotent for the same provider instance.
5. The provider unregisters during `session_shutdown`.

This two-way handshake removes any dependency on extension load order.

## Wire contract

Machine-local providers use these event names:

| Event | Payload | Purpose |
| --- | --- | --- |
| `pi-mcp:provider-register` | Provider object | Register tools and status sections |
| `pi-mcp:provider-unregister` | Exact provider object used for registration | Remove only that provider instance's state and deactivate its tools |
| `pi-mcp:registry-ready` | `undefined` | Ask providers loaded earlier to announce themselves |

Use literal event names in a machine-local provider rather than importing an installed package path. Package locations differ between local, git, and npm installations.

## Provider shape

A provider has:

```ts
type McpToolProvider = {
  id: string;
  name: string;
  tools: ToolDefinition<any, any, any>[];
  registerTools?(register: (tool: ToolDefinition<any, any, any>) => void): void;
  getStatusSections(): McpStatusSection[] | Promise<McpStatusSection[]>;
};

type McpStatusSection = {
  title: string;
  lines: string[];
};
```

- `id` must be stable and unique.
- `name` is the provider heading shown by `/mcp`.
- `tools` contains tools known when the provider registers.
- `registerTools` is optional and supports tools discovered asynchronously after registration.
- `getStatusSections` returns provider-owned, display-safe status.

Prefer static `tools` unless discovery is genuinely asynchronous. The mock example uses the simpler static form.

## Tool names and ownership

Use globally unique Pi tool names, conventionally:

```text
mcp__<provider>__<tool>
```

The registry preserves the first healthy owner of a tool name. A conflicting provider fails registration instead of replacing that tool.

Providers must not place credentials, authorization headers, tokens, or private response content in tool names, descriptions, status sections, or thrown errors.

## Status and failures

Providers own their named sections because only they understand their servers and applications. Represent an individual server failure as status data while retaining healthy server sections and tools:

```ts
getStatusSections() {
  return [
    { title: "Primary server", lines: ["ready", "tools: search"] },
    { title: "Optional server", lines: ["failed: connection unavailable"] },
  ];
}
```

If an entire provider status callback throws, `/mcp` reports a generic provider failure and continues displaying healthy providers. Thrown error text is not displayed, preventing accidental secret exposure.

A failed MCP server should not throw from the provider factory or crash Pi. Catch server-specific failures inside the provider, retain healthy clients, and report the failed server in a status section.

## Lifecycle cleanup

Keep the disposer returned by your registration handshake and invoke it from `session_shutdown`. The disposer must emit the exact provider object used during registration, not only its string ID. Exact object identity prevents a rejected duplicate from removing the accepted provider that owns the same ID. Pi rebuilds extension runtimes during reload, new-session, resume, and fork flows. Cleanup prevents stale provider state and duplicate tools.

The complete load-order and cleanup pattern is in [`examples/mcp-provider/index.ts`](../../examples/mcp-provider/index.ts). For a concrete stdio MCP implementation, see [`examples/bevy-debugger-mcp/index.ts`](../../examples/bevy-debugger-mcp/index.ts). It demonstrates PATH-gated loading, MCP initialization, tool discovery, tool calls, status reporting, and shutdown cleanup.

## Reusable stdio client

`./stdio-client.ts` exports `StdioMcpClient`, a small newline-delimited JSON-RPC client for MCP servers using stdio transport. Providers can reuse it while retaining ownership of their command name, tool-name prefix, status text, and lifecycle policy. It is also re-exported from this extension's public module.

## Testing a provider

At minimum, verify:

- Registry-first and provider-first loading produce the same tools.
- Repeated registry readiness does not duplicate tools.
- Shutdown unregisters the provider.
- A failed server does not hide healthy servers.
- Status output contains no secrets.
- Tool names do not collide with another provider.

Run this repository's example and registry checks with:

```bash
node --test examples/mcp-provider/index.test.ts
node --test extensions/mcp/*.test.ts
npm run check
```

The example test loads the real registry and the decoupled mock provider together, invokes its tool, inspects `/mcp`, and verifies shutdown cleanup.
