// e07s01 — Spike Bash parsing and subcommand permission contracts
//
// Lightweight parser for evaluating Bash subcommand permission contracts.
// This is a spike: it handles core syntax (commands, &&, ||, ;, |, bash -c,
// quotes, redirects) and marks complex syntax (substitutions, loops, functions)
// as unsupported — fail-closed.

export type ParsedSubcommand = {
  /** Normalized text for permission rule matching (e.g., "jj status") */
  normalized: string;
  /** Source span in the original command string */
  span: { start: number; end: number };
  /** The command name (e.g., "jj", "git", "bash") */
  command: string;
  /** Arguments as separate strings */
  args: string[];
};

export type BashParseResult =
  | { ok: true; subcommands: ParsedSubcommand[] }
  | { ok: false; reason: "unsupported_syntax" | "parse_error"; detail: string };

export function parseBashCommand(_command: string): BashParseResult {
  // STUB — returns parse_error so tests fail for the right reason
  return { ok: false, reason: "parse_error", detail: "not implemented" };
}
