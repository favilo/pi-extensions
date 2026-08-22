import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { stringify as stringifyToml } from "smol-toml";
import { preflightEdit } from "./edit-preflight.ts";

function fixture(content: string): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "pi-edit-preflight-"));
  const path = join(dir, "file.txt");
  writeFileSync(path, content);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a valid unique edit passes preflight", async () => {
  const { path, cleanup } = fixture("alpha\nbeta\ngamma\n");
  try {
    assert.deepEqual(await preflightEdit(path, [{ oldText: "beta", newText: "BETA" }]), { ok: true });
  } finally {
    cleanup();
  }
});

test("an edit whose oldText is absent fails with the not-found reason", async () => {
  const { path, cleanup } = fixture("alpha\nbeta\ngamma\n");
  try {
    const result = await preflightEdit(path, [{ oldText: "delta", newText: "DELTA" }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /Could not find the exact text/);
  } finally {
    cleanup();
  }
});

test("an edit whose oldText matches more than once fails with the duplicate reason", async () => {
  const { path, cleanup } = fixture("beta\nalpha\nbeta\n");
  try {
    const result = await preflightEdit(path, [{ oldText: "beta", newText: "BETA" }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /Found 2 occurrences/);
  } finally {
    cleanup();
  }
});

test("overlapping edits fail with the overlap reason", async () => {
  const { path, cleanup } = fixture("alpha beta gamma\n");
  try {
    const result = await preflightEdit(path, [
      { oldText: "alpha beta", newText: "x" },
      { oldText: "beta gamma", newText: "y" },
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /overlap/);
  } finally {
    cleanup();
  }
});

test("an empty oldText fails with the empty-text reason", async () => {
  const { path, cleanup } = fixture("alpha\n");
  try {
    const result = await preflightEdit(path, [{ oldText: "", newText: "x" }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /oldText must not be empty/);
  } finally {
    cleanup();
  }
});

test("an edit that changes nothing fails with the no-change reason", async () => {
  const { path, cleanup } = fixture("alpha\n");
  try {
    const result = await preflightEdit(path, [{ oldText: "alpha", newText: "alpha" }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /No changes made/);
  } finally {
    cleanup();
  }
});

test("an unreadable target file fails instead of prompting", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-edit-preflight-"));
  try {
    const result = await preflightEdit(join(dir, "missing.txt"), [{ oldText: "a", newText: "b" }]);
    assert.equal(result.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fuzzy whitespace differences still pass, matching edit tool semantics", async () => {
  const { path, cleanup } = fixture("alpha  \nbeta\n");
  try {
    assert.deepEqual(await preflightEdit(path, [{ oldText: "alpha\nbeta", newText: "x" }]), { ok: true });
  } finally {
    cleanup();
  }
});

test("a doomed edit is blocked before the permission prompt is shown", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-edit-preflight-agent-"));
  writeFileSync(join(agentDir, "permissions.toml"), stringifyToml({ permissions: {} }));
  const project = mkdtempSync(join(tmpdir(), "pi-edit-preflight-project-"));
  writeFileSync(join(project, "file.txt"), "alpha\nbeta\n");

  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;

  let promptShown = false;
  const handlers = new Map<string, (event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => Promise<unknown>>();
  try {
    const { default: toolPermissionPolicy } = await import(`./index.ts?edit-preflight=${encodeURIComponent(agentDir)}`);
    toolPermissionPolicy({
      registerCommand() {},
      on(event: string, handler: (event: { toolName: string; input: Record<string, unknown> }, ctx: unknown) => Promise<unknown>) {
        if (event === "tool_call") handlers.set(event, handler);
      },
      getAllTools: () => [],
    } as never);

    const result = await handlers.get("tool_call")!(
      { toolName: "edit", input: { path: join(project, "file.txt"), edits: [{ oldText: "delta", newText: "DELTA" }] } },
      {
        cwd: project,
        hasUI: true,
        mode: "json",
        ui: {
          confirm: () => {
            promptShown = true;
            return Promise.resolve(false);
          },
        },
      },
    );

    assert.equal(promptShown, false, "permission prompt must not be shown for a deterministically failing edit");
    assert.equal((result as { block?: boolean }).block, true);
    assert.match((result as { reason?: string }).reason ?? "", /Could not find the exact text/);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  }
});
