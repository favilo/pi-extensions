---
bug_id: BUG-2026-11-20T101309
status: open
severity: high
scope: subagent-account-runtime
title: Selected child model unavailable with account switcher
---

## Problem

The user reports subagent launches fail with `Selected child model is unavailable: cursor/auto`, including when different models are selected. Expected: use the approved account and model in an isolated child runtime. Reproduce with the installed pi-account-switcher and real configured account/model; test explicit, one-shot, and inherited selection without exposing credentials.

## Root Cause Analysis

### Reproduce

A subagent launch with an active account that has no configured model inherits the parent extension-provider model. The launch then fails because that provider/model is not available in the fresh child runtime.

### Isolate

The isolated child runtime contains Pi built-in providers but no provider or model catalog registered by the parent extension. Directly querying that runtime for the inherited extension model returns no model. In contrast, a built-in provider such as `openai-codex` has a model catalog in the same runtime.

### Hypotheses tested

1. **Stale or incorrectly inherited parent model** — falsified. The parent model is deliberately inherited when the account has no model.
2. **API credential rejected** — falsified. The failure occurs before a request can use credentials, during local model lookup.
3. **Child runtime lacks the extension-provider catalog** — confirmed. The provider is registered by a parent extension, not by Pi's built-in model runtime. The child creates a bare runtime and suppresses extensions. Account-switcher only replaces credentials on a provider already available in the runtime, so it cannot make the extension provider or its catalog available.

### Verified root cause

The child-runtime construction contract assumes that account-switcher credential installation also makes every selected provider/model available. That is false for extension-provided providers. With no child-local copy of the selected provider definition and model catalog, lookup of the correctly selected inherited model fails before child session creation.

Contributing factor: existing tests use synthetic account-switcher selections that explicitly register a provider, so they do not cover an extension-provided provider that is absent from a fresh child runtime.

Risk level: Medium. This is an availability failure for delegated work. Security impact: LOW — no security exploit path identified; the fix must preserve child-local credential isolation and avoid exposing account secrets.

## TDD Fix Plan

1. **RED**: Add a behavioral integration test using a synthetic extension provider and synthetic model. The provider must be available in the parent registry but absent from a fresh child runtime; assert a child session starts with the selected model rather than failing model lookup.
   **GREEN**: Extend the child-runtime selection contract so it can install or transfer the selected provider/model definition into the isolated runtime before account-specific authentication is installed. Preserve the redacted descriptor boundary.
   **verify**: `npm test -- extensions/subagent/account-runtime.test.ts`

2. **RED**: Add a test for inherited selection with an account that has no configured model and a synthetic parent extension model; assert it uses the inherited model after provider registration.
   **GREEN**: Use the parent runtime/provider definition as the source for child-local provider registration, without enabling arbitrary child extensions or falling back to the parent credential store.
   **verify**: `npm test -- extensions/subagent/account-runtime.test.ts`

3. **RED**: Add tests that explicit and one-shot account/model selection remain isolated, consume one-shot selection only after successful child session construction, and do not expose API keys in descriptors, errors, or logs.
   **GREEN**: Keep the existing delayed-consumption and redacted-selection guarantees while applying the provider bootstrap.
   **verify**: `npm test -- extensions/subagent/account-runtime.test.ts extensions/tool-permissions/index.test.ts`

**REFACTOR**: Consolidate child provider bootstrap behind a typed selection capability; remove duplicated model-registration setup while retaining clear errors for truly unknown providers or models.

## Acceptance Criteria

- [ ] An extension-backed selected account can launch a subagent with an explicit extension model.
- [ ] An extension-backed selected account without a configured model can launch using the inherited parent extension model.
- [ ] Built-in and custom providers retain current child-runtime behavior.
- [ ] The child runtime uses only the selected account's credentials.
- [ ] No account credentials appear in descriptors, errors, logs, or approval prompts.
- [ ] New and existing tests pass.

## Resolution

<!-- filled in by validate-fix -->
