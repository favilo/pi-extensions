# e07s05 — Recursive subcommand parsing for command substitutions and subshells

## 1. Identity
- **Story:** e07s05
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
Users need commands containing command substitutions (`$(cmd)` and `` `cmd` ``) or subshells `(cmd)` to be parsed recursively so inner subcommands are evaluated against policy rules instead of falling back to unsupported syntax prompts.

## 3. Goal
Extend `bash-parser.ts` to recursively parse `CommandExpansion` (`$(cmd)`, `` `cmd` ``) and `Subshell` / `BraceGroup` nodes, extracting inner subcommands with accurate source spans for evaluation.

## 4. Non-goals
- Executing dynamic command output during parsing.
- Supporting arbitrary eval or dynamic variable expansion.

## 5. Requirements
- Recursively extract subcommands inside `$(...)` and `` `...` `` command substitution word parts.
- Recursively extract subcommands inside `(...)` subshell nodes.
- Maintain source spans relative to outer command text.
- Evaluate extracted inner subcommands atomically against policy rules.

## 17. Acceptance criteria
### Scenario: Command substitution extraction
**Given** `echo $(jj status)`
**When** the command is parsed
**Then** subcommands `echo ...` and `jj status` are extracted and evaluated independently against rules.

## 18. Automated verification
- `node --test extensions/tool-permissions/bash-parser.test.ts`
- `node --test extensions/tool-permissions/bash-subcommands.test.ts`
- `npm run check`
