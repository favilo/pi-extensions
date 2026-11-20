# e21s03 — Propose-permission-rule tool and companion skill

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e21s03
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 3
- **Risk:** P0
- **Delta:** ADDED

## 2. User need

Some good allow rules are hard to invent by hand (for example `jj diff ...`). The agent should propose a concrete rule for audit; approval writes it into the named project or user permissions file.

## 3. Goal

- Add a tool that proposes one permission rule, shows it for audit, and on approval loads it into the requested permissions file (project or user).
- The tool **can never be allow-listed**. Every call stays an explicit approval. An allow rule for the tool itself must not match.
- Ship a companion skill with the pi-extensions plugin so loading that skill is enough to drive the permission edit.

## 4. Non-goals

- Auto-saving rules without explicit approval.
- Replacing Ctrl+E forever edit (e21s01).

## 5. Acceptance criteria (outline)

- Approving a proposed rule persists exactly that rule to the named scope.
- Denying leaves permissions files unchanged.
- An allow rule targeting the propose tool never short-circuits the prompt.
- The bundled skill documents how to drive the tool.
