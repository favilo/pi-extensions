import assert from "node:assert/strict";
import test from "node:test";
import { McpProviderRegistry, type McpToolProvider } from "./registry.ts";

function statusProvider(id: string, getStatusSections: McpToolProvider["getStatusSections"]): McpToolProvider {
  return { id, name: `${id} provider`, tools: [], getStatusSections };
}

test("a failing provider status does not hide healthy providers", async () => {
  const registry = new McpProviderRegistry(() => {});
  registry.register(statusProvider("broken", () => {
    throw new Error("authorization=secret-value");
  }));
  registry.register(statusProvider("healthy", () => [{ title: "Healthy server", lines: ["ready"] }]));

  const sections = await registry.getStatusSections();

  assert.deepEqual(sections, [
    {
      providerId: "broken",
      providerName: "broken provider",
      title: "Provider failure",
      lines: ["status unavailable"],
    },
    {
      providerId: "healthy",
      providerName: "healthy provider",
      title: "Healthy server",
      lines: ["ready"],
    },
  ]);
  assert.doesNotMatch(JSON.stringify(sections), /secret-value/);
});

test("a conflicting provider tool does not replace the healthy owner", () => {
  const registeredTools: string[] = [];
  const registry = new McpProviderRegistry((tool) => registeredTools.push(tool.name));
  const sharedTool = {
    name: "mcp__shared__ping",
    label: "ping",
    description: "ping",
    parameters: { type: "object", properties: {} } as never,
    async execute() {
      return { content: [{ type: "text" as const, text: "pong" }], details: {} };
    },
  };
  const alpha = { ...statusProvider("alpha", () => []), tools: [sharedTool] };
  const beta = { ...statusProvider("beta", () => []), tools: [sharedTool] };

  assert.deepEqual(registry.register(alpha), { ok: true });
  assert.deepEqual(registry.register(beta), { ok: false, error: "MCP provider failed to register: beta" });
  assert.deepEqual(registeredTools, ["mcp__shared__ping"]);
});

test("a provider registration failure does not block later providers", async () => {
  const registry = new McpProviderRegistry(() => {});
  const broken = statusProvider("broken", () => []);
  broken.registerTools = () => {
    throw new Error("failed to discover tools");
  };

  assert.deepEqual(registry.register(broken), { ok: false, error: "MCP provider failed to register: broken" });
  assert.deepEqual(registry.register(statusProvider("healthy", () => [{ title: "Server", lines: ["ready"] }])), { ok: true });

  const sections = await registry.getStatusSections();
  assert.equal(sections.at(-1)?.providerId, "healthy");
});
