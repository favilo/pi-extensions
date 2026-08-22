import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import builtInToolRenderer from "./index.ts";

type RenderedResult = {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
};

type EditRenderer = {
  parameters?: { properties?: Record<string, unknown>; required?: string[] };
  renderCall?(
    args: Record<string, unknown>,
    theme: unknown,
  ): { render(width: number): string[] };
  renderResult(
    result: RenderedResult,
    options: { expanded: boolean; isPartial: boolean },
    theme: unknown,
    context: { isError: boolean },
  ): { render(width: number): string[] };
};

function captureTool(name: string): EditRenderer {
  const tools = new Map<string, EditRenderer>();
  builtInToolRenderer({
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool as unknown as EditRenderer);
    },
  } as unknown as ExtensionAPI);
  const tool = tools.get(name);
  assert.ok(tool, `expected the ${name} tool renderer to be registered`);
  return tool;
}

function captureEditRenderer(): EditRenderer {
  return captureTool("edit");
}

// Identity theme: strip colors/formatting so assertions see plain text.
const theme = new Proxy({}, {
  get: () => (...args: unknown[]) => String(args[args.length - 1]),
});

function renderEdit(renderer: EditRenderer, result: RenderedResult, isError: boolean): string {
  return renderer
    .renderResult(result, { expanded: false, isPartial: false }, theme, { isError })
    .render(120)
    .join("\n");
}

test("a failed edit renders its reason, never Applied", () => {
  const renderer = captureEditRenderer();
  const rendered = renderEdit(renderer, {
    content: [{ type: "text", text: "Could not find the exact text in /tmp/file.txt. The old text must match exactly including all whitespace and newlines." }],
  }, true);

  assert.match(rendered, /Could not find the exact text/);
  assert.doesNotMatch(rendered, /Applied/);
});

test("a blocked edit renders the block reason, never Applied", () => {
  const renderer = captureEditRenderer();
  const rendered = renderEdit(renderer, {
    content: [{ type: "text", text: "User denied edit." }],
  }, true);

  assert.match(rendered, /User denied edit/);
  assert.doesNotMatch(rendered, /Applied/);
});

test("a successful edit without a diff still renders Applied", () => {
  const renderer = captureEditRenderer();
  const rendered = renderEdit(renderer, {
    content: [{ type: "text", text: "Done" }],
  }, false);

  assert.match(rendered, /Applied/);
});

test("the edit and bash tool schemas admit an optional reason", () => {
  for (const name of ["edit", "bash", "write"]) {
    const tool = captureTool(name);
    assert.ok(tool.parameters?.properties?.reason, `${name} schema must admit a reason`);
    assert.ok(!tool.parameters?.required?.includes("reason"), `${name} reason must be optional`);
  }
});

test("the edit call renders the reason when present", () => {
  const renderer = captureEditRenderer();
  const rendered = renderer
    .renderCall!({ path: "/tmp/file.txt", edits: [], reason: "normalize casing before the rename" }, theme)
    .render(120)
    .join("\n");

  assert.match(rendered, /normalize casing before the rename/);
});

test("the bash call renders the reason when present", () => {
  const renderer = captureTool("bash");
  const rendered = renderer
    .renderCall!({ command: "npm test", reason: "verify the refactor is green" }, theme)
    .render(120)
    .join("\n");

  assert.match(rendered, /verify the refactor is green/);
});

test("calls without a reason render exactly as before", () => {
  const edit = captureEditRenderer()
    .renderCall!({ path: "/tmp/file.txt", edits: [] }, theme)
    .render(120)
    .join("\n");
  assert.doesNotMatch(edit, /reason/i);

  const bash = captureTool("bash")
    .renderCall!({ command: "npm test" }, theme)
    .render(120)
    .join("\n");
  assert.doesNotMatch(bash, /reason/i);
});
