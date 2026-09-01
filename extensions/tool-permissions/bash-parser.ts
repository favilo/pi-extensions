// e07s05 — Recursive Bash parsing for command substitutions and subshells
//
// Uses `unbash` (0-dep TypeScript Bash parser) to parse compound Bash commands,
// subshells, and command substitutions `$(cmd)` / `` `cmd` `` into individual subcommands.

import { parse, type ParsedScript, type Node, type Command, type Word, type WordPart } from "unbash";

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

/** Convert a Word to its evaluated value (unquoted). */
function wordValue(word: Word): string {
  return word.value;
}

/** Word part types that execute or expand dynamically — fail-closed. */
const UNSUPPORTED_PART_TYPES = new Set([
  "ProcessSubstitution",
  "ArithmeticExpansion",
  "ParameterExpansion",
]);

/** Check whether a word contains any non-handled dynamic expansion parts. */
function hasUnsupportedParts(word: Word): boolean {
  if (!word.parts) return false;
  return word.parts.some((part: WordPart) => UNSUPPORTED_PART_TYPES.has(part.type));
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

    case "Subshell":
    case "BraceGroup": {
      const bodyCommands = (node as any).body?.commands;
      if (Array.isArray(bodyCommands)) {
        for (const child of bodyCommands) {
          const result = extractSubcommands(child, source, subcommands);
          if (!result.ok) return result;
        }
      }
      return { ok: true };
    }

    case "CompoundList": {
      const commands = (node as any).commands;
      if (Array.isArray(commands)) {
        for (const child of commands) {
          const result = extractSubcommands(child, source, subcommands);
          if (!result.ok) return result;
        }
      }
      return { ok: true };
    }

    case "Command": {
      const allWords = [node.name, ...node.suffix].filter((w): w is Word => w !== undefined);

      // Check for unsupported word parts
      const unsafeWord = allWords.find(hasUnsupportedParts);
      if (unsafeWord) {
        return {
          ok: false,
          detail: `unsupported syntax: dynamic expansion in word "${unsafeWord.text}"`,
        };
      }

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

      // Check for command substitutions in word parts: $(cmd) or `cmd`
      for (const word of allWords) {
        if (!word.parts) continue;
        for (const part of word.parts) {
          if (part.type === "CommandExpansion") {
            const innerScript = (part as any).script;
            if (innerScript && Array.isArray(innerScript.commands)) {
              for (const innerStmt of innerScript.commands) {
                const result = extractSubcommands(innerStmt, source, subcommands);
                if (!result.ok) return result;
              }
            }
          }
        }
      }

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
