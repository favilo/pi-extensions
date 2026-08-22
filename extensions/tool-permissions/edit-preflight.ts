import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createEditTool } from "@earendil-works/pi-coding-agent";

export type EditPair = { oldText: string; newText: string };

export type EditPreflightResult = { ok: true } | { ok: false; reason: string };

/**
 * Deterministic validation of edit preconditions against the current file
 * content. Dry-runs the real edit tool with a no-op writeFile so validation
 * semantics (matching, duplicates, overlap, no-change) always track the
 * tool itself instead of a forked copy. A doomed edit fails here, before any
 * permission prompt is shown, with the exact reason the tool would produce.
 */
export async function preflightEdit(path: string, edits: EditPair[]): Promise<EditPreflightResult> {
  const tool = createEditTool(dirname(path), {
    operations: {
      readFile: (target) => readFile(target),
      writeFile: () => Promise.resolve(),
      access: (target) => access(target, constants.R_OK | constants.W_OK),
    },
  });
  try {
    await tool.execute("edit-preflight", { path, edits }, undefined);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
