# e07s01 — Spike Bash parsing and subcommand permission contracts

## 1. Identity
- **Story:** e07s01
- **Type:** spike
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
Users need compound Bash commands to be permissioned as understandable individual commands without unsafe parser assumptions.

## 3. Goal
Evaluate `bash-ast`, `bash-parser`, and comparable maintained options, then produce a parser contract for the syntax the permission boundary will support. Explicit `bash -c` payloads are first-class input.

## 4. Non-goals
- Production parser integration.
- Allowing unsupported syntax by default.
- Replacing the existing Bash permission UI.
- Executing parsed commands during the spike.

## 5. Requirements
- Characterize lists, pipelines, redirects, substitutions, functions, loops, nested shells, and quoted arguments.
- Parse the payload of explicit `bash -c` invocations.
- Preserve source spans and enough normalized text to identify a denied subcommand to the agent.
- Compare dependency maintenance, syntax coverage, licensing, bundle impact, and failure behavior.
- Define fail-closed behavior for unsupported or uncertain syntax.

## 6. Failure modes
Parser divergence from Bash, malformed input, shell nesting, command substitution, unsupported grammar, dependency abandonment, and loss of source text.

## 17. Acceptance criteria
### Scenario: Parser comparison
**Given** the candidate parser options
**When** the spike evaluates the representative syntax corpus
**Then** it records coverage, limitations, maintenance, and a recommendation.

### Scenario: Explicit bash -c
**Given** `bash -c` with a quoted compound command
**When** the spike parses it
**Then** the payload is analyzed as Bash and its subcommand source spans are retained.

### Scenario: Unsupported syntax
**Given** syntax outside the selected contract
**When** parsing cannot establish safe subcommands
**Then** the result is marked unsupported and cannot auto-allow execution.

## 18. Automated verification
- `node --test extensions/tool-permissions/bash-parser-spike.test.ts`
- `npm run check`

## 19. Definition of done
A parser decision record, syntax contract, representative corpus, dependency assessment, and fail-closed behavior specification exist.
