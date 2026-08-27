import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";

type ToolCallHandler = (event: { toolName?: string; input?: Record<string, unknown>; toolCallId: string }, ctx: unknown) => Promise<unknown>;
type ToolResultHandler = (event: { toolCallId: string; content: Array<{ type: string; text?: string }>; isError?: boolean }, ctx: unknown) => unknown;
type PromptComponent = { render(width: number): string[]; handleInput(data: string): void };

test("renders a permission preview as a non-context history entry while keeping the live prompt compact", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-permission-preview-agent-"));
  const project = mkdtempSync(join(tmpdir(), "pi-permission-preview-project-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({ permissions: {} }));

  const handlers = new Map<string, ToolCallHandler>();
  const entries: Array<{ customType: string; data: unknown }> = [];
  const renderers = new Map<string, (entry: { data: unknown }, options: { expanded: boolean }, theme: { fg(color: string, text: string): string; bold(text: string): string }) => PromptComponent | undefined>();
  let component: PromptComponent | undefined;

  try {
    const { default: toolPermissionPolicy } = await import(`./index.ts?permission-preview=${encodeURIComponent(agentDir)}`);
    toolPermissionPolicy({
      registerCommand() {},
      registerEntryRenderer(customType: string, renderer: (entry: { data: unknown }, options: { expanded: boolean }, theme: { fg(color: string, text: string): string; bold(text: string): string }) => PromptComponent | undefined) {
        renderers.set(customType, renderer);
      },
      appendEntry(customType: string, data: unknown) {
        entries.push({ customType, data });
      },
      on(event: string, handler: ToolCallHandler | ToolResultHandler) {
        if (event === "tool_call" || event === "tool_result") handlers.set(event, handler as ToolCallHandler);
      },
      getAllTools: () => [],
    } as never);

    const preview = Array.from({ length: 80 }, (_, index) => `line-${index + 1}`).join("\n");
    const pending = handlers.get("tool_call")!({
      toolName: "bash",
      toolCallId: "preview-call",
      input: { command: preview },
    }, {
      cwd: project,
      hasUI: true,
      mode: "tui",
      sessionId: "preview-session",
      ui: {
        notify() {},
        confirm: async () => false,
        custom<T>(factory: (tui: { requestRender(): void }, theme: unknown, keybindings: unknown, done: (value: T) => void) => PromptComponent): Promise<T> {
          return new Promise<T>((resolve) => {
            component = factory({ requestRender() {} }, { fg: (_color: string, text: string) => text, bold: (text: string) => text }, {}, resolve);
          });
        },
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.customType, "permission-preview");
    const entryData = entries[0]!.data as { title: string; body: string };
    assert.equal(entryData.title, "Allow bash command?");
    assert.match(entryData.body, /line-80/);
    assert.doesNotMatch(entryData.body, /pi wants to run/, "the preview carries content only, not prompt prose");
    assert.ok(component);
    const promptText = component.render(100).join("\n");
    assert.doesNotMatch(promptText, /line-80/);

    const renderer = renderers.get("permission-preview");
    assert.ok(renderer);
    const fakeTheme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
    const bodyLines = entryData.body.split("\n").length;
    const previewComponent = renderer({ data: entries[0]!.data }, { expanded: false }, fakeTheme)!;

    // While the prompt waits, the review render shows the content without repeating prompt chrome.
    const reviewText = previewComponent.render(100).join("\n");
    assert.match(reviewText, /line-80/);
    assert.doesNotMatch(reviewText, /Allow bash command\?/, "the review render omits the title already shown in the prompt frame");

    // Ctrl+O (app.tools.expand) toggles the reviewed entry while the prompt owns input.
    component.handleInput("\x0f");
    const collapsedDuringReview = previewComponent.render(100).join("\n");
    assert.doesNotMatch(collapsedDuringReview, /line-80/);
    assert.match(collapsedDuringReview, new RegExp(`${bodyLines} lines`, "i"));
    component.handleInput("\x0f");
    assert.match(previewComponent.render(100).join("\n"), /line-80/);

    component.handleInput("\x04");
    await pending;

    // After the decision, the recorded entry shows its title and respects the collapsed state.
    const collapsedAfterDecision = previewComponent.render(100).join("\n");
    assert.doesNotMatch(collapsedAfterDecision, /line-80/);
    assert.match(collapsedAfterDecision, /Allow bash command\?/);
    assert.match(collapsedAfterDecision, new RegExp(`${bodyLines} lines`, "i"));
    const expandedAfterDecision = renderer({ data: entries[0]!.data }, { expanded: true }, fakeTheme)!.render(100).join("\n");
    assert.match(expandedAfterDecision, /Allow bash command\?/);
    assert.match(expandedAfterDecision, /line-80/);

    const toolResult = handlers.get("tool_result") as unknown as ToolResultHandler | undefined;
    toolResult?.({ toolCallId: "preview-call", content: [{ type: "text", text: "ok" }] }, {});
    assert.equal(entries.length, 2, "the reviewed preview is re-appended after the tool result so it stays visible below the output");
    assert.deepEqual(entries[1], entries[0]);

    toolResult?.({ toolCallId: "unprompted-call", content: [{ type: "text", text: "ok" }] }, {});
    assert.equal(entries.length, 2, "unprompted calls never gain permission previews");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
