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
 *
 * Each subcommand extracted from the command string is evaluated independently
 * against the tool permission policy for "bash".
 * - If any subcommand or raw command matches a deny rule, the entire command is denied atomically.
 * - If any subcommand is unsupported or unparseable, the command is denied (fail-closed).
 * - If all subcommands are allowed (or raw command matches an allow rule), the command is allowed.
 * - Otherwise (if any subcommand requires user approval), the decision is "ask".
 */
export function evaluateBashSubcommands(
  command: string,
  cwd: string,
  options?: Parameters<typeof resolveToolPermissionDecision>[3],
): SubcommandDecisionResult {
  const parseResult = parseBashCommand(command);
  if (!parseResult.ok) {
    return {
      decision: "deny",
      subcommands: [],
      reason: `Blocked bash command: ${parseResult.detail}`,
    };
  }

  const rawDecision = resolveToolPermissionDecision("bash", { command }, cwd, options);
  if (rawDecision.decision === "deny") {
    return {
      decision: "deny",
      subcommands: parseResult.subcommands,
      reason: "Blocked bash command: arguments match a configured deny rule.",
      source: rawDecision.source,
    };
  }

  const subcommands = parseResult.subcommands;
  if (subcommands.length === 0) {
    return {
      decision: rawDecision.decision,
      subcommands: [],
      source: rawDecision.source,
    };
  }

  let hasAsk = false;
  let allowedSource: string | undefined;

  for (const sub of subcommands) {
    const decision = resolveToolPermissionDecision("bash", { command: sub.normalized }, cwd, options);
    if (decision.decision === "deny") {
      return {
        decision: "deny",
        subcommands,
        deniedSubcommand: sub,
        reason: `Blocked bash command: subcommand "${sub.normalized}" matches a configured deny rule.`,
        source: decision.source,
      };
    }
    if (decision.decision === "ask") {
      hasAsk = true;
    } else if (decision.decision === "allow") {
      allowedSource = decision.source;
    }
  }

  if (!hasAsk) {
    return {
      decision: "allow",
      subcommands,
      source: allowedSource,
    };
  }

  if (rawDecision.decision === "allow") {
    return {
      decision: "allow",
      subcommands,
      source: rawDecision.source,
    };
  }

  return {
    decision: "ask",
    subcommands,
  };
}
