import { parseBashCommand, type ParsedSubcommand } from "./bash-parser.ts";
import { resolveToolPermissionDecision } from "./index.ts";

export type SubcommandDecisionResult = {
  decision: "allow" | "deny" | "ask";
  subcommands: ParsedSubcommand[];
  deniedSubcommand?: ParsedSubcommand;
  reason?: string;
  source?: string;
};

export type EvaluateSubcommandOptions = Parameters<typeof resolveToolPermissionDecision>[3] & {
  audit?: (entry: Record<string, unknown>) => void;
};

/**
 * Evaluates individual Bash subcommands against permission policy rules.
 *
 * Each subcommand extracted from the command string is evaluated independently
 * against the tool permission policy for "bash".
 * - If any subcommand or raw command matches a deny rule, the entire command is denied atomically.
 * - If any subcommand is unsupported or unparseable, the command falls back to "ask" (fail-asking) unless a deny rule matches.
 * - If all subcommands are allowed (or raw command matches an allow rule), the command is allowed.
 * - Otherwise (if any subcommand requires user approval), the decision is "ask".
 */
export function evaluateBashSubcommands(
  command: string,
  cwd: string,
  options?: EvaluateSubcommandOptions,
): SubcommandDecisionResult {
  const safeAudit = (entry: Record<string, unknown>) => {
    if (!options?.audit) return;
    try {
      options.audit(entry);
    } catch {
      // Non-blocking audit failure handling
    }
  };

  const rawDecision = resolveToolPermissionDecision("bash", { command }, cwd, options);
  if (rawDecision.decision === "deny") {
    const reason = "Blocked bash command: arguments match a configured deny rule.";
    safeAudit({ tool: "bash", command, decision: "deny", cwd, reason, source: rawDecision.source });
    return {
      decision: "deny",
      subcommands: [],
      reason,
      source: rawDecision.source,
    };
  }

  const parseResult = parseBashCommand(command);
  if (!parseResult.ok) {
    if (rawDecision.decision === "allow") {
      safeAudit({ tool: "bash", command, decision: "allow", cwd, source: rawDecision.source });
      return {
        decision: "allow",
        subcommands: [],
        source: rawDecision.source,
      };
    }
    const reason = `Bash command contains unsupported syntax (${parseResult.detail}) and requires explicit permission.`;
    safeAudit({ tool: "bash", command, decision: "ask", cwd, reason });
    return {
      decision: "ask",
      subcommands: [],
      reason,
    };
  }

  const subcommands = parseResult.subcommands;
  if (subcommands.length === 0) {
    safeAudit({ tool: "bash", command, decision: rawDecision.decision, cwd, source: rawDecision.source });
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
    safeAudit({
      tool: "bash",
      command,
      subcommand: sub.normalized,
      decision: decision.decision,
      cwd,
      ...(sub.span ? { span: sub.span } : {}),
      ...(decision.source ? { source: decision.source } : {}),
    });

    if (decision.decision === "deny") {
      const reason = `Blocked bash command: subcommand "${sub.normalized}" matches a configured deny rule.`;
      safeAudit({
        tool: "bash",
        command,
        decision: "deny",
        deniedSubcommand: sub.normalized,
        cwd,
        reason,
      });
      return {
        decision: "deny",
        subcommands,
        deniedSubcommand: sub,
        reason,
        source: decision.source,
      };
    }
    if (decision.decision === "ask") {
      hasAsk = true;
    } else if (decision.decision === "allow") {
      allowedSource = decision.source;
    }
  }

  const finalDecision: "allow" | "ask" = !hasAsk || rawDecision.decision === "allow" ? "allow" : "ask";
  const finalSource = finalDecision === "allow" ? (allowedSource ?? rawDecision.source) : undefined;

  safeAudit({
    tool: "bash",
    command,
    decision: finalDecision,
    cwd,
    ...(finalSource ? { source: finalSource } : {}),
  });

  return {
    decision: finalDecision,
    subcommands,
    source: finalSource,
  };
}

/**
 * Saves allow rules for individual subcommands to permissions.toml.
 * Stub implementation for TDD contract test phase.
 */
export function saveSubcommandAllowRules(
  targetPath: string,
  subcommands: string[],
): boolean {
  return false;
}
