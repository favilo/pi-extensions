# Threat Model — e06 Permission-enforced runnable subagents

## Scope

This threat model covers the planned `AgentSession` spike and the follow-on runtime stories. The current change is exploratory; no production subagent runtime is being added in this step.

In scope:

- Constructing and disposing child `AgentSession` instances.
- Parent-to-child context, task, progress, cancellation, and failure propagation.
- Child working-directory selection and inheritance.
- Child tool-call interception by the existing `tool-permissions` boundary.
- Nested-agent behavior and unavailable interactive UI.

Out of scope:

- Bash subcommand parsing (e07).
- A production subagent tool implementation (e06s02+).
- Changes that bypass the existing permission hook.

## Assets and trust boundaries

| Asset | Boundary / concern |
|---|---|
| User files and repository contents | Child tools must remain subject to the same scoped permission policy; cwd must not silently widen access. |
| Permission policy files | Child execution must not edit or replace policy files without an explicit permitted operation. |
| Provider credentials and model context | Child sessions must not expose credentials through inherited prompts, logs, or tool output. |
| Parent session/UI | Child failure, cancellation, and permission requests must not leave orphan work or fail open when UI is absent. |
| Audit records | Decisions and denials must remain attributable to the child operation and effective cwd. |

## Abuse cases and mitigations

### Authorization bypass — HIGH if introduced

A child session could invoke tools through an SDK path that does not emit the extension hook, bypassing the existing permission boundary.

**Required mitigation:** The spike must explicitly prove hook coverage for child tool calls. Production work must fail closed unless every child tool call is intercepted and evaluated through `resolveToolPermissionDecision` / the existing permission handler.

### Working-directory escape — HIGH if introduced

A child may inherit the process cwd, select an arbitrary cwd, or resolve policy from a parent directory, causing repository or user-file access outside the intended scope.

**Required mitigation:** Carry an explicit child cwd; resolve policy from that cwd; apply the existing trust and repository-boundary rules; reject ambiguous or missing cwd rather than falling back to a broader directory.

### Nested-agent recursion / resource exhaustion — MEDIUM

A child may create further agents without a depth or cancellation boundary, causing runaway model/tool activity or leaked sessions.

**Required mitigation:** Measure nested behavior in the spike. Production contract must define a bounded nesting policy, cancellation propagation, and deterministic disposal in `finally` blocks.

### Cancellation and orphan process — MEDIUM

Cancellation may stop the parent turn while leaving a child session, child tool, or external process running.

**Required mitigation:** Verify cancellation and disposal independently; require idempotent cleanup and tests that assert no live child remains after cancellation or failure.

### Missing UI fail-open — HIGH if introduced

A child permission request may be unable to display the main UI and accidentally proceed.

**Required mitigation:** Reuse the existing no-UI behavior: allow only an explicit matching policy rule; otherwise deny and audit. Never treat unavailable UI as approval.

### Prompt/context and credential leakage — MEDIUM

Inherited parent context may include secrets or unrelated private content, and child output may be returned to a broader audience.

**Required mitigation:** Inventory inherited context in the spike. Production contract must define the minimum context passed to children, redact credentials from diagnostics, and avoid persisting raw prompts/tool results in audit logs.

### Audit attribution loss — LOW/MEDIUM

Child decisions may be logged as parent operations, weakening reviewability and incident response.

**Required mitigation:** Preserve tool, decision, cwd, and child-operation identity in audit entries without recording secret-bearing inputs.

## Security review result

No new production vulnerability is present in the current working-tree plan because e06 runtime code is not yet implemented. The spike is security-gated: any evidence that `AgentSession` tool calls bypass the extension boundary is a blocking finding for production stories.

**Verdict:** PASS for the exploratory spike only, with the HIGH-risk mitigations above required before e06s02–e06s04 implementation.

## Verification obligations

- Prove child tool interception and record the result.
- Prove explicit cwd and policy resolution behavior.
- Prove cancellation and disposal leave no live child session.
- Prove missing UI denies without an allow rule.
- Keep the spike disposable and isolated; do not add a bypass or production execution path.
