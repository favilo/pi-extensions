import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { StdioMcpClient } from "../../extensions/mcp/stdio-client.ts";
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

test("bevy_brp_mcp completes MCP initialization and tool discovery", { skip: !isCommandOnPath("bevy_brp_mcp") }, async () => {
  const client = new StdioMcpClient({ command: "bevy_brp_mcp", requestTimeoutMs: 15_000 });
  try {
    const tools = await client.start();
    assert.ok(tools.some((tool) => tool.name === "brp_status"));
  } finally {
    client.close();
  }
});
