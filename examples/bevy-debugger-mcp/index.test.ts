import "../../extensions/test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StdioMcpClient } from "../../extensions/mcp/stdio-client.ts";
import bevyDebuggerMcpExtension from "./index.ts";
import { isCommandOnPath } from "./path.ts";

test("the Bevy provider stays absent when bevy_brp_mcp is not on PATH", () => {
  assert.equal(isCommandOnPath("bevy_brp_mcp", "/definitely/not-a-path"), false);
});

test("PATH detection recognizes an executable provider binary", async () => {
  const directory = await mkdtemp(join("/tmp", "bevy-debugger-mcp-"));
  const binary = join(directory, "bevy_brp_mcp");
  await writeFile(binary, "#!/bin/sh\n");
  await chmod(binary, 0o755);

  assert.equal(isCommandOnPath("bevy_brp_mcp", directory), true);
});

test("the extension disposes the provider on session shutdown", () => {
  const events = new Map<string, Set<(data: unknown) => void>>();
  const lifecycle = new Map<string, Array<() => void>>();
  const pi = {
    events: {
      emit(channel: string, data: unknown) {
        for (const handler of events.get(channel) ?? []) handler(data);
      },
      on(channel: string, handler: (data: unknown) => void) {
        const handlers = events.get(channel) ?? new Set();
        handlers.add(handler);
        events.set(channel, handlers);
        return () => handlers.delete(handler);
      },
    },
    on(name: string, handler: () => void) {
      lifecycle.set(name, [...(lifecycle.get(name) ?? []), handler]);
    },
  } as unknown as ExtensionAPI;

  let announced: { dispose(): void } | undefined;
  pi.events.on("pi-mcp:provider-register", (data) => {
    announced = data as { dispose(): void };
  });

  bevyDebuggerMcpExtension(pi, {
    command: "bevy_brp_mcp",
    spawnProcess: () => {
      throw new Error("must not spawn without a registry");
    },
  });
  assert.ok(announced, "expected the provider to announce itself");

  let disposed = 0;
  const originalDispose = announced.dispose.bind(announced);
  announced.dispose = () => {
    disposed++;
    originalDispose();
  };

  for (const handler of lifecycle.get("session_shutdown") ?? []) handler();

  assert.equal(disposed, 1);
});

test("bevy_brp_mcp completes MCP initialization and tool discovery", { skip: !isCommandOnPath("bevy_brp_mcp") }, async () => {
  const client = new StdioMcpClient({ command: "bevy_brp_mcp", requestTimeoutMs: 15_000 });
  try {
    const tools = await client.start();
    assert.ok(tools.some((tool) => tool.name === "brp_status"));
  } finally {
    client.close();
  }
});
