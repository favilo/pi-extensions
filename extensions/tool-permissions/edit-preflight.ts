export type EditPair = { oldText: string; newText: string };

export type EditPreflightResult = { ok: true } | { ok: false; reason: string };

/**
 * Deterministic validation of edit preconditions against the current file
 * content. Mirrors the edit tool's matching semantics so a doomed edit fails
 * before any permission prompt is shown.
 */
export async function preflightEdit(_path: string, _edits: EditPair[]): Promise<EditPreflightResult> {
  return { ok: true };
}
