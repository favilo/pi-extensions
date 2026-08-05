import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import subagentExtension from "./index.ts";

test("registers the subagent launch tool", () => {
  const tools: Array<{ name: string }> = [];
  const pi = {
    registerTool(tool: { name: string }) {
      tools.push(tool);
    },
  } as unknown as ExtensionAPI;

  subagentExtension(pi);

  assert.deepEqual(tools.map(({ name }) => name), ["subagent"]);
});
