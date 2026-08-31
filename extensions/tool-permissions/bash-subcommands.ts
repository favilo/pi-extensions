import { parseBashCommand, type ParsedSubcommand } from "./bash-parser.ts";
import { resolveToolPermissionDecision } from "./index.ts";

export type SubcommandDecisionResult = {
  decision: "allow" | "deny" | "ask";
  subcommands: ParsedSubcommand[];
  deniedSubcommand?: ParsedSubcommand;
  reason?: string;
  source?: string;
};

/**
 * Evaluates individual Bash subcommands against permission policy rules.
 * Stub implementation for TDD contract test phase.
 */
export function evaluateBashSubcommands(
  command: string,
  cwd: string,
  options?: Parameters<typeof resolveToolPermissionDecision>[3],
): SubcommandDecisionResult {
  return {
    decision: "ask",
    subcommands: [],
  };
}
