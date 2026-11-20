# e07s03 — Audit Bash components and report denied subcommands to agents

## 1. Identity
- **Story:** e07s03
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 2
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
When a compound command is blocked, the agent needs to know exactly which subcommand failed and why, while the audit log retains the complete decision trail.

## 3. Goal
Record an audit event for every parsed subcommand and for the complete Bash invocation. Return structured denial details to the requesting agent, including the failed subcommand and any steering description supplied during the permission interaction.

## 4. Non-goals
- A second audit store.
- Exposing secrets or raw parser internals.
- Changing the existing audit retention policy.
- Showing denial details only in the UI.

## 5. Requirements
- Audit normalized subcommand text, source position where available, decision, reason, and effective cwd.
- Audit the complete original Bash command and aggregate result.
- Return the denied subcommand and possible reason in the tool error/result sent to the agent.
- Preserve steering text as contextual metadata without treating it as an authorization rule.
- Keep audit writes non-blocking and preserve existing failure handling.

## 6. Failure modes
Audit write failure, redacted command data, multiple denied components, missing source span, parser diagnostic leakage, and steering text containing sensitive data.

## 17. Acceptance criteria
### Scenario: Component and aggregate audit
**Given** a parsed Bash command with multiple subcommands
**When** permission evaluation completes
**Then** each component and the complete invocation have audit records.

### Scenario: Agent-facing denial
**Given** one subcommand is denied
**When** the Bash tool returns
**Then** the agent receives the denied subcommand, safe reason, and statement that the complete command was blocked.

### Scenario: Steering context
**Given** the user supplies a steering description during an ask
**When** a subcommand is denied
**Then** the agent-facing result and audit record retain the steering context according to existing redaction rules.

### Scenario: Audit failure
**Given** an audit write fails
**When** a permission decision completes
**Then** the tool decision remains unchanged and the audit failure does not allow execution or block unrelated permission handling.

## 18. Automated verification
- `node --test extensions/tool-permissions/bash-subcommands.test.ts`
- `node --test extensions/tool-permissions/audit.test.ts`
- `npm run check`

## 19. Definition of done
Component and aggregate audit records exist, agents receive actionable denial details, steering context is handled safely, and audit failures remain non-blocking.
