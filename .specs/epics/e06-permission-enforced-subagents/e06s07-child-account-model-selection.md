# e06s07 — Launch subagents with an isolated account and model

## Identity
- **Story:** e06s07
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P0
- **Delta:** ADDED

## Reason for existence
A parent must be able to delegate work to a child using a selected account and model without changing the parent’s credentials, model, or process-wide environment. A launch approval must identify the resolved runtime and remain correctly serialized with all other permission prompts.

## Goal
Add optional `account` and `model` fields to `subagent`. Resolve explicit, account-switcher one-shot, and inherited account selection before child creation. Start the child with a child-local Pi model runtime and selected model. Support the existing `openai-codex` OAuth accounts (`work`, `personal`) first.

## Non-goals
- Loading account-switcher commands or tools in child sessions.
- Letting children select/change accounts or models after launch.
- Process-wide environment mutation, temporary or otherwise.
- Arbitrary environment-backed accounts, custom API-key providers, or Antigravity/Gemini in this story.
- Changing global parent account/model state.

## Requirements
- `subagent({ task, account?, model? })` accepts a named account and a `provider/model-id` model selector.
- Selection precedence is explicit `account`, then `PI_ACCOUNT_SWITCHER_NEXT_ID`, then `PI_ACCOUNT_SWITCHER_ACTIVE_ID`; otherwise preserve existing default child-model behavior.
- A one-shot override is consumed only after the user approves and child construction succeeds. Denial, cancellation, validation failure, and construction failure retain it.
- Account-switcher publishes a read-only selection API returning account ID, provider, model ID, source, and a credential-installation adapter. `tool-permissions` and `subagent` use that same API; neither reads account-switcher private JSON directly.
- The first adapter supports only Pi OAuth accounts for the built-in `openai-codex` provider. It installs the chosen credential into a child-local runtime/provider resolver. The parent runtime and `process.env` remain unchanged.
- OAuth refresh updates only the selected account-switcher account record, using an atomic/serialized update contract; it does not overwrite a different account or require the parent session to switch.
- Explicit or env-derived runtime selection always requires a single interactive parent launch approval, even when a broad `permissions.subagent.allow = [{}]` rule matches. A matching configured deny remains authoritative.
- The launch approval uses the shared parent-session FIFO queue and shows resolved account ID, selection source, provider/model, and that later child tool calls require separate approvals.
- Non-interactive calls with selected runtime deny fail-closed. Existing no-runtime configured allow behavior remains unchanged.
- The child retains only `subagent-tool-request`; account-switcher tools and provider-management commands are never exposed to it.

## Failure modes
Unknown account, malformed model selector, model/account provider mismatch, unsupported account credential type, unavailable provider/model, refresh persistence failure, no UI, denied/cancelled approval, concurrent launches, and stale one-shot consumption.

## Interfaces
```ts
subagent({
  task: "Inspect the repository",
  account: "personal",                 // optional
  model: "openai-codex/gpt-5.6",       // optional
})
```

The shared resolver returns a redacted selection descriptor. Credential values never enter permission prompts, debug logs, task results, or parent context.

**Reason for depth:** one shared resolver prevents the permission prompt from approving a different account/model than the runtime that is actually launched.

## Acceptance criteria
### Selected account launch
**Given** `personal` is selected explicitly or through an account-switcher override
**When** the parent approves the launch
**Then** the child uses `personal`’s `openai-codex` OAuth credential and selected model while the parent runtime and environment remain unchanged.

### Broad allow cannot hide a runtime change
**Given** a broad configured allow rule exists for `subagent`
**When** an explicit or inherited account/model is selected
**Then** the shared FIFO displays a runtime-specific launch approval before child construction.

### One-shot safety
**Given** `PI_ACCOUNT_SWITCHER_NEXT_ID` names an account
**When** launch is denied, cancelled, or fails before child construction
**Then** the override remains available; when launch succeeds it is consumed exactly once.

### Refresh isolation
**Given** a child refreshes a selected OAuth credential
**When** persistence succeeds
**Then** only that selected account record is updated and no parent account/model switch occurs.

## Automated verification
- `node --test extensions/subagent/account-runtime.test.ts`
- `node --test extensions/subagent/agent-session.test.ts extensions/subagent/index.test.ts`
- `node --test extensions/tool-permissions/index.test.ts extensions/tool-permissions/prompt-queue.test.ts`
- Account-switcher: resolver and refresh-persistence tests in its repository
- `npm run check`

## Implementation tasks
1. Extract account-switcher’s read-only child runtime selection and credential adapter as a public, redacted contract; serialize selected-account OAuth refresh persistence.
2. Add the `account`/`model` schema, validate selectors, and resolve the same descriptor for permission presentation and child construction.
3. Require one FIFO launch approval for every resolved account/model selection despite broad allows; preserve configured deny and fail closed with no UI.
4. Create a child-local `ModelRuntime` and override the built-in `openai-codex` provider auth resolver with the selected OAuth account. Pass the selected model to `createAgentSession`.
5. Consume the one-shot override only after successful construction; verify parallel parent/child and child/child account isolation.
6. Reject unsupported raw-env/API-key/custom-provider/Antigravity selections with actionable errors until their child-local adapters are separately specified.

## Definition of done
A user can explicitly or implicitly select either existing Codex OAuth account for a child, approve the exact resolved runtime once through the existing FIFO, and run that child without changing the parent account/model/environment or exposing account-switcher capabilities to the child.
