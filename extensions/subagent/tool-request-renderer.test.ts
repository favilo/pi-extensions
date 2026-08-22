import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderSubagentToolRequestCall, type SubagentToolRequestCallArgs } from "./tool-request-renderer.ts";

const dummyTheme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
};

test("renders multiline bash commands with real line breaks instead of escaped \\n strings", () => {
  const args: SubagentToolRequestCallArgs = {
    toolName: "bash",
    input: {
      command: "echo line1\necho line2\necho line3",
    },
  };

  const component = renderSubagentToolRequestCall(args, dummyTheme as never);
  const lines = component.render(80);

  assert.equal(lines.length >= 3, true);
  const text = lines.join("\n");
  assert.match(text, /subagent-tool-request/);
  assert.match(text, /bash/);
  assert.match(text, /echo line1/);
  assert.match(text, /echo line2/);
  assert.match(text, /echo line3/);
  assert.doesNotMatch(text, /\\n/);
});

test("renders file tool calls cleanly with formatted arguments and width bounds", () => {
  const args: SubagentToolRequestCallArgs = {
    toolName: "write",
    input: {
      path: "src/main.ts",
      content: "const x = 1;\nconst y = 2;",
    },
  };

  const component = renderSubagentToolRequestCall(args, dummyTheme as never);
  const width = 80;
  const lines = component.render(width);

  assert.equal(lines.length > 0, true);
  for (let i = 0; i < lines.length; i++) {
    const w = visibleWidth(lines[i] ?? "");
    assert.equal(w <= width, true, `Line ${i + 1} exceeds width ${width}: ${w} chars`);
  }

  const text = lines.join("\n");
  assert.match(text, /write/);
  assert.match(text, /src\/main\.ts/);
});
