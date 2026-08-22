import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import builtInToolRenderer from "./index.ts";

type RenderedResult = {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
};

type ToolRenderer = {
  renderCall?(
    args: Record<string, unknown>,
    theme: unknown,
    context?: unknown,
  ): { render(width: number): string[] };
  renderResult(
    result: RenderedResult,
    options: { expanded: boolean; isPartial: boolean },
    theme: unknown,
    context: { isError: boolean },
  ): { render(width: number): string[] };
};

function captureTool(name: string): ToolRenderer {
  const tools = new Map<string, ToolRenderer>();
  builtInToolRenderer({
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool as unknown as ToolRenderer);
    },
  } as unknown as ExtensionAPI);
  const tool = tools.get(name);
  assert.ok(tool, `expected the ${name} tool renderer to be registered`);
  return tool;
}

const theme = new Proxy({}, {
  get: () => (...args: unknown[]) => String(args[args.length - 1]),
});

test("collapsed bash result keeps compact summary and truncated call preview", () => {
  const bash = captureTool("bash");
  const longCmd = "echo " + "a".repeat(100);
  const callText = bash.renderCall!({ command: longCmd }, theme, { args: { command: longCmd }, isError: false } as never).render(120).join("\n");
  assert.match(callText, /\.\.\./);
  assert.ok(callText.trim().length < 100);

  const resultText = bash.renderResult({
    content: [{ type: "text", text: "exit code: 0\nline 1" }],
  }, { expanded: false, isPartial: false }, theme, { args: { command: longCmd }, isError: false } as never).render(120).join("\n");

  assert.match(resultText, /done/);
  assert.doesNotMatch(resultText, /line 1/);
});

test("expanded bash result includes full unshortened command before output", () => {
  const bash = captureTool("bash");
  const longCmd = "echo " + "x".repeat(120) + "\nline 2 of command";
  const resultText = bash.renderResult({
    content: [{ type: "text", text: "exit code: 0\noutput line 1" }],
  }, { expanded: true, isPartial: false }, theme, { args: { command: longCmd }, isError: false } as never).render(120).join("\n");

  assert.match(resultText, new RegExp("x".repeat(120)));
  assert.match(resultText, /line 2 of command/);
  assert.match(resultText, /output line 1/);
});

test("expanded bash result renders all output lines beyond 20 lines", () => {
  const bash = captureTool("bash");
  const lines = Array.from({ length: 35 }, (_, i) => `line ${i + 1}`).join("\n");
  const resultText = bash.renderResult({
    content: [{ type: "text", text: `exit code: 0\n${lines}` }],
  }, { expanded: true, isPartial: false }, theme, { isError: false }).render(120).join("\n");

  assert.match(resultText, /line 35/);
  assert.doesNotMatch(resultText, /more output/);
});

test("denied or failed bash command renders error text instead of done", () => {
  const bash = captureTool("bash");
  const resultText = bash.renderResult({
    content: [{ type: "text", text: "User denied bash command." }],
  }, { expanded: false, isPartial: false }, theme, { isError: true }).render(120).join("\n");

  assert.match(resultText, /User denied bash command/);
  assert.doesNotMatch(resultText, /done/);
});

test("expanded bash result preserves upstream truncation indicator", () => {
  const bash = captureTool("bash");
  const resultText = bash.renderResult({
    content: [{ type: "text", text: "exit code: 0\nline 1" }],
    details: { truncation: { truncated: true, totalLines: 50 } },
  }, { expanded: true, isPartial: false }, theme, { isError: false }).render(120).join("\n");

  assert.match(resultText, /\[truncated\]/);
});
