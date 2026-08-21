import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { McpProviderRegistry, type McpToolProvider } from "./registry.ts";

function provider(id: string, toolName: string, title: string): McpToolProvider {
  return {
    id,
    name: title,
    tools: [
      {
        name: toolName,
        label: toolName,
        description: `Tool from ${title}`,
        parameters: { type: "object", properties: {}, additionalProperties: false } as never,
        async execute() {
          return { content: [{ type: "text", text: title }], details: {} };
        },
      },
    ],
    async getStatusSections() {
      return [{ title, lines: ["ready"] }];
    },
  };
}

test("a provider can contribute tools after registration", () => {
  const registeredTools: string[] = [];
  let contributeTool: ((tool: McpToolProvider["tools"][number]) => void) | undefined;
  const dynamicProvider: McpToolProvider = {
    id: "dynamic",
    name: "Dynamic provider",
    tools: [],
    registerTools(register) {
      contributeTool = register;
    },
    getStatusSections: () => [],
  };
  const registry = new McpProviderRegistry((tool) => registeredTools.push(tool.name));

  registry.register(dynamicProvider);
  contributeTool?.(provider("source", "mcp__dynamic__later", "Dynamic").tools[0]);

  assert.deepEqual(registeredTools, ["mcp__dynamic__later"]);
});

test("multiple MCP providers contribute tools and named status sections", async () => {
  const registeredTools: string[] = [];
  const registry = new McpProviderRegistry((tool) => registeredTools.push(tool.name));

  assert.deepEqual(registry.register(provider("alpha", "mcp__alpha__ping", "Alpha")), { ok: true });
  assert.deepEqual(registry.register(provider("beta", "mcp__beta__ping", "Beta")), { ok: true });

  assert.deepEqual(registeredTools, ["mcp__alpha__ping", "mcp__beta__ping"]);
  assert.deepEqual(await registry.getStatusSections(), [
    { providerId: "alpha", providerName: "Alpha", title: "Alpha", lines: ["ready"] },
    { providerId: "beta", providerName: "Beta", title: "Beta", lines: ["ready"] },
  ]);
});

test("unregistering a provider disposes its resources exactly once", () => {
  let disposed = 0;
  const disposable: McpToolProvider = {
    ...provider("alpha", "mcp__alpha__ping", "Alpha"),
    dispose() {
      disposed++;
    },
  };
  const registry = new McpProviderRegistry(() => {});
  registry.register(disposable);

  registry.unregister(disposable);
  registry.unregister(disposable);

  assert.equal(disposed, 1);
});

test("unregisterAll disposes every registered provider", () => {
  const disposed: string[] = [];
  const registry = new McpProviderRegistry(() => {});
  for (const id of ["alpha", "beta"]) {
    registry.register({
      ...provider(id, `mcp__${id}__ping`, id),
      dispose() {
        disposed.push(id);
      },
    });
  }

  registry.unregisterAll();

  assert.deepEqual(disposed.sort(), ["alpha", "beta"]);
});

test("status collection for 100 synchronous providers completes within 50 ms", async () => {
  const registry = new McpProviderRegistry(() => {});
  for (let index = 0; index < 100; index += 1) {
    registry.register({
      id: `provider-${index}`,
      name: `Provider ${index}`,
      tools: [],
      getStatusSections: () => [{ title: "Status", lines: ["ready"] }],
    });
  }

  const startedAt = performance.now();
  const sections = await registry.getStatusSections();
  const elapsedMs = performance.now() - startedAt;

  assert.equal(sections.length, 100);
  assert.ok(elapsedMs < 50, `expected status collection under 50 ms, received ${elapsedMs.toFixed(2)} ms`);
});
