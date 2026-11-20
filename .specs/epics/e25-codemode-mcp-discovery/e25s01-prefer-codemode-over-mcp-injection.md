# e25s01 — Replace MCP tool injection with codemode discovery

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e25s01
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 5
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

Injecting MCP tools into the session bloats context. Prefer that the agent finds and calls configured MCP tools through `codemode` instead of session-catalog injection.

## 3. Goal

Replace the current MCP tool injection path with a model where agents discover and invoke those tools via codemode, while keeping permission evaluation and audit intact for the resulting calls.

## 4. Non-goals

- Removing MCP server configuration itself.
- Changing non-MCP built-in tools.
- The activate_skill dedupe work in e21s04.

## 5. Acceptance criteria (outline)

- MCP tools are not injected wholesale into the session tool catalog.
- Agents can still discover and call configured MCP tools through codemode.
- Permission prompts and audits still cover those calls.
