// e07s01 — Spike Bash parsing and subcommand permission contracts
//
// Uses `unbash` (0-dep TypeScript Bash parser) to parse compound Bash commands
// into individual subcommands with source spans. Complex syntax (command
// substitution, loops, functions, conditionals) is marked unsupported —
// fail-closed — so the permission boundary never auto-allows uncertain syntax.

import { parse, type ParsedScript, type Node, type Command, type Word } from "unbash";

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

/** Node types that are too complex for safe subcommand-level permissioning. */
const UNSUPPORTED_TYPES = new Set([
  "If", "For", "ArithmeticFor", "Select", "While", "Function",
  "Subshell", "BraceGroup", "Case", "Coproc", "TestCommand",
  "ArithmeticCommand",
]);

/** Convert a Word to its display string (uses .text which preserves original quoting). */
function wordText(word: Word): string {
  return word.text;
}

/** Convert a Word to its evaluated value (unquoted). */
function wordValue(word: Word): string {
  return word.value;
}

/** Extract subcommands from a single Command node. */
function commandToSubcommand(cmd: Command, source: string): ParsedSubcommand {
  const name = cmd.name;
  const args = cmd.suffix.map(wordValue);
  const command = name ? wordValue(name) : "";
  const normalized = [command, ...args].join(" ");
  return {
    command,
    args,
    normalized,
    span: { start: cmd.pos, end: cmd.end },
  };
}

/** Walk the AST and extract subcommands, detecting unsupported syntax. */
function extractSubcommands(
  node: Node,
  source: string,
  subcommands: ParsedSubcommand[],
): { ok: true } | { ok: false; detail: string } {
  switch (node.type) {
    case "Statement": {
      // A Statement wraps a command with optional background (&) and redirects.
      return extractSubcommands(node.command, source, subcommands);
    }

    case "AndOr": {
      // Compound command: cmd1 && cmd2 || cmd3
      for (const child of node.commands) {
        const result = extractSubcommands(child, source, subcommands);
        if (!result.ok) return result;
      }
      return { ok: true };
    }

    case "Pipeline": {
      // Pipeline: cmd1 | cmd2 | cmd3
      for (const child of node.commands) {
        const result = extractSubcommands(child, source, subcommands);
        if (!result.ok) return result;
      }
      return { ok: true };
    }

    case "Command": {
      // Check for bash -c 'payload' — recursively parse the payload.
      if (node.name && wordValue(node.name) === "bash") {
        const dashC = node.suffix.find((w) => wordValue(w) === "-c");
        if (dashC) {
          // The next word after -c is the payload
          const dashCIndex = node.suffix.indexOf(dashC);
          const payloadWord = node.suffix[dashCIndex + 1];
          if (payloadWord) {
            const payload = wordValue(payloadWord);
            const inner = parseBashCommand(payload);
            if (inner.ok) {
              // Adjust inner spans to be relative to the outer source
              for (const sub of inner.subcommands) {
                subcommands.push({
                  ...sub,
                  span: {
                    start: sub.span.start + payloadWord.pos,
                    end: sub.span.end + payloadWord.pos,
                  },
                });
              }
              return { ok: true };
            }
            // Inner parse failed — propagate the failure
            return {
              ok: false,
              detail: inner.detail,
            };
          }
        }
      }

      subcommands.push(commandToSubcommand(node, source));
      return { ok: true };
    }

    default:
      // Any node type we don't explicitly handle is unsupported.
      return {
        ok: false,
        detail: `unsupported syntax: ${node.type}`,
      };
  }
}

export function parseBashCommand(command: string): BashParseResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { ok: false, reason: "parse_error", detail: "empty command" };
  }

  let script: ParsedScript;
  try {
    script = parse(trimmed);
  } catch (error) {
    return {
      ok: false,
      reason: "parse_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  // unbash reports errors as non-throwing ParseError entries
  if (script.errors && script.errors.length > 0) {
    return {
      ok: false,
      reason: "parse_error",
      detail: script.errors.map((e) => e.message).join("; "),
    };
  }

  const subcommands: ParsedSubcommand[] = [];
  for (const statement of script.commands) {
    const result = extractSubcommands(statement, trimmed, subcommands);
    if (!result.ok) {
      return {
        ok: false,
        reason: "unsupported_syntax",
        detail: result.detail,
      };
    }
  }

  if (subcommands.length === 0) {
    return { ok: false, reason: "parse_error", detail: "no subcommands found" };
  }

  return { ok: true, subcommands };
}
