import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import builtInToolRenderer from "./index.ts";

type RenderedResult = {
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
};

type EditRenderer = {
  renderResult(
    result: RenderedResult,
    options: { expanded: boolean; isPartial: boolean },
    theme: unknown,
    context: { isError: boolean },
  ): { render(width: number): string[] };
};

function captureEditRenderer(): EditRenderer {
  const tools = new Map<string, EditRenderer>();
  builtInToolRenderer({
    registerTool(tool: { name: string }) {
      tools.set(tool.name, tool as unknown as EditRenderer);
    },
  } as unknown as ExtensionAPI);
  const edit = tools.get("edit");
  assert.ok(edit, "expected the edit tool renderer to be registered");
  return edit;
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
