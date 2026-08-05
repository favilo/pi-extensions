# e05s01 — Show current provider usage

## 1. Identity

- **Story:** e05s01
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

A Pi user needs to see current provider quota and account usage without leaving the session or manually visiting a provider dashboard.

## 3. Goal

Add a `/usage` command that resolves the provider and account currently active in Pi context, fetches provider-reported usage through a provider-neutral adapter, and renders a safe, useful summary.

## 4. Non-goals

- Changing any `/accounts:*` command or behavior; those commands belong to the existing accounts plugin.
- Reimplementing account discovery or account switching.
- Building a provider-specific command instead of a provider-neutral usage surface.
- Requiring all providers to expose usage data.
- Enumerating every account in the initial implementation when the accounts plugin does not already expose that data cleanly.
- Exposing credentials, access tokens, or raw provider error payloads.

## 5. Users

Interactive Pi users with one or more provider accounts configured through the existing accounts plugin.

## 6. User journey

The user runs `/usage`. Pi reads the current provider and the account selected by the most recent `/accounts:*` operation, requests usage from the provider integration, and displays the available quota, reset, cost, and rate-limit information. If usage is unsupported or unavailable, Pi explains that without crashing or exposing provider internals.

## 7. Preconditions

- The extension is loaded by Pi.
- Pi context exposes the current provider/model selection and the active account resulting from the accounts plugin.
- The provider integration can either fetch usage or report that usage is unsupported.

## 8. Inputs

Pi runtime context, active provider/model, active account identity, provider usage adapter, and the provider response or failure.

## 9. Outputs

A user-visible usage summary, an explicit unsupported state, or a safe failure message. No account or provider configuration is mutated.

## 10. Requirements

### ADDED: Current provider resolution

`/usage` shall resolve the provider from Pi context rather than from a duplicated configuration lookup. The displayed provider must correspond to the provider currently selected for the session.

### ADDED: Current account resolution

`/usage` shall use the account currently active in Pi context, including the account selected by the most recent `/accounts:*` plugin command. The usage command must not change account selection.

### ADDED: Provider-neutral usage adapter

Usage fetching shall be isolated behind a small provider-neutral interface. Provider-specific authentication, request construction, response parsing, and unsupported behavior remain in the provider integration.

### ADDED: Usage summary

When available, the summary should include provider and account identity, plan or tier, quota used and remaining, reset time, spend or cost, and rate limits. Fields unavailable from a provider are omitted or shown as unavailable; fabricated values are forbidden.

### ADDED: Safe failure behavior

Unsupported usage, missing account context, provider/API failures, malformed responses, and timeouts shall produce a concise user-visible result without crashing Pi or displaying raw secret-bearing provider error text.

### RETAINED: Accounts plugin boundary

All `/accounts:*` commands and their behavior remain owned by the existing accounts plugin. `/usage` consumes their resulting active-account context and does not replace, wrap, or alter those commands.

### OPTIONAL: All-account summary

If the accounts plugin already exposes safe account enumeration and the provider adapter can fetch each account without duplicated discovery or authentication logic, a follow-up may show all accounts. This is not required for the initial story and must not delay current-account support.

## 11. Quality attributes

Provider-neutrality, backward compatibility, safe error handling, deterministic rendering, no credential disclosure, and no new dependency unless required by an existing provider integration.

## 12. Interfaces and contracts

**Purpose:** Resolve current provider/account context, delegate usage retrieval, and render a safe summary.

**Callers:** Pi's command dispatcher and interactive users.

**Contracts:** Context is read-only; `/usage` reflects the most recently selected account; provider adapters may return usage, unsupported, or safe failure; rendering never includes raw provider error payloads.

**Reason for depth:** Provider and account selection are owned by Pi and the accounts plugin. Duplicating either boundary would make `/usage` stale after account switching and risk inconsistent authentication behavior.

## 13. State

No persistent state is added. A request may use bounded in-memory caching only if needed for provider rate limits; cache behavior must not make account switches display stale usage.

## 14. Dependencies

- `[COMPOSE] Pi runtime context` — current provider/model and active account.
- `[COMPOSE] Existing accounts plugin` — `/accounts:*` commands and account selection.
- `[EXTEND] Existing provider integration` — provider-specific usage retrieval.
- `[ADD] Provider-neutral usage adapter and `/usage` command surface`.
- No new dependency unless an existing provider requires one.

## 15. Failure modes

No current provider, no active account, provider does not support usage, account switch races with a request, provider timeout, authentication failure, rate limiting, malformed usage response, unavailable optional fields, or secret-bearing provider error text.

## 16. Observability

The command identifies provider and account in successful output. Failures identify the safe category and provider name, but not raw response bodies, tokens, headers, or credential material.

## 17. Acceptance criteria

### Scenario: Current provider and account

**Given** Pi has a current provider and active account
**When** the user runs `/usage`
**Then** the result identifies that provider and account and displays all usage fields supplied by the provider.

### Scenario: Account switch is respected

**Given** the user runs an existing `/accounts:*` switch command
**When** the user then runs `/usage`
**Then** usage is fetched for the newly active account without changing account selection.

### Scenario: Optional fields are absent

**Given** a provider does not return one or more optional fields
**When** `/usage` renders
**Then** unavailable fields are omitted or clearly marked unavailable and no values are invented.

### Scenario: Unsupported provider

**Given** the current provider has no usage integration
**When** the user runs `/usage`
**Then** Pi reports that usage is unsupported for that provider without crashing.

### Scenario: Provider failure

**Given** usage retrieval times out, is unauthorized, rate-limited, or returns malformed data
**When** the user runs `/usage`
**Then** Pi shows a concise safe failure and does not expose raw provider error text.

### Scenario: Accounts behavior remains unchanged

**Given** any existing `/accounts:*` command
**When** the command is used before or after `/usage`
**Then** its existing behavior and account-selection semantics remain unchanged.

### Scenario: All-account extension is optional

**Given** the accounts plugin exposes safe enumeration without duplicated discovery
**When** all-account support is implemented
**Then** it is additive and does not change current-account behavior. Otherwise the initial story remains complete with current-account support.

## 18. Automated verification

- `node --test extensions/usage/index.test.ts`
- `node --test extensions/usage/documentation.test.ts`
- `npm run check`

## 19. Implementation steps

1. Add command, provider-context, active-account, adapter, unsupported, and safe-failure contracts → verify: `node --test extensions/usage/index.test.ts`
2. Implement current provider/account resolution and provider-neutral usage adapter → verify: `node --test extensions/usage/index.test.ts`
3. Implement deterministic usage rendering and document `/usage`, including provider/account limitations → verify: `node --test extensions/usage/documentation.test.ts`
4. Evaluate all-account support only if the existing accounts plugin exposes it without duplicated logic → verify: `node --test extensions/usage/index.test.ts`
5. Run package regression and type checks → verify: `npm run check`

## 20. Definition of done

`/usage` reports safe provider usage for the provider and account currently active in Pi context, respects the latest `/accounts:*` selection, handles unsupported and failed providers without crashes or secret leakage, leaves accounts-plugin behavior unchanged, has focused tests and documentation, and passes the package checks.
