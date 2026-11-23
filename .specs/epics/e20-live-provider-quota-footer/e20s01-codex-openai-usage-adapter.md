# e20s01 — Real Codex and OpenAI OAuth usage adapter

## 1. Identity

- **Story:** e20s01
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 2
- **Risk:** P1
- **Delta:** ADDED
- **WSJF:** Ships first inside e20 (Codex-first ordering).

## 2. User need

A Pi user on ChatGPT/Codex OAuth needs real 5-hour and 7-day remaining quota, not a JWT identity string that pretends to be usage.

## 3. Goal

Replace the broken OpenAI/Codex branch in `extensions/usage/` with a multi-pass-style `wham/usage` checker. Resolve credentials through the active account-switcher OAuth entry first, then `auth.json`. Expose structured 5h/7d windows through the existing provider-neutral adapter so `/usage` and later stories share one result shape.

## 4. Non-goals

- Installing or depending on `pi-multi-pass`.
- Building the footer UI (e20s02).
- Anthropic or Google checkers (e20s03).
- Changing `/accounts:*` behavior.
- Showing every configured account; current provider/account only.

## 5. Prior art

| Candidate | Source | Verdict | Notes |
|-----------|--------|---------|-------|
| `hjanuschka/pi-multi-pass` Codex checker | `/Users/kevin.oberlies/git/agents/pi-multi-pass/extensions/multi-sub.ts` (`codexQuotaChecker`, `parseCodexUsageSnapshot`) | extend | Port endpoint, headers, window parse, and `chatgpt_account_id` gate; do not take pools/subs. |
| Existing e05 `/usage` adapter | `extensions/usage/index.ts` | extend | Keep adapter surface; replace OpenAI/Codex OAuth implementation. |

## 6. Requirements

### ADDED: Shared quota result fields

Usage results for supported OAuth providers shall carry structured windows (`label`, `remainingPercent`, `resetAt`) plus `worstRemainingPercent`, `planType`, and `email` when the provider supplies them. Fabricated values are forbidden.

### ADDED: Credential resolution order

For the current provider, resolve OAuth credentials in this order:

1. Active account-switcher account `piAuth.entry` for that provider.
2. `~/.pi/agent/auth.json` entry for the provider name.

If neither yields a usable OAuth access token, report a safe missing-auth or unsupported state.

### ADDED: Codex / OpenAI OAuth checker

- `openai-codex` and `openai` OAuth with a `chatgpt_account_id` claim call `GET {CHATGPT_BASE_URL\|https://chatgpt.com/backend-api}/wham/usage` with `Authorization: Bearer <access>` and `chatgpt-account-id`.
- Parse primary/secondary rate-limit windows into **5h** and **7d** remaining percentages (`100 - used_percent`).
- OpenAI OAuth tokens without `chatgpt_account_id` report that usage is unavailable for that login without treating it as a crash; requests may still work.
- API-key OpenAI paths may keep header-based rate-limit probing or report unsupported for subscription windows; do not invent 5h/7d values from API keys.

### MODIFIED: `/usage` Codex path

`/usage` for Codex/OpenAI OAuth shall render real window data (or a safe failure) instead of “Active ChatGPT OAuth session … verified.”

### RETAINED: e05 safety rules

No access/refresh tokens, raw response bodies, or secret-bearing headers in user-visible output. Timeouts, 401/429, and malformed payloads produce concise safe failures.

## 7. Acceptance criteria

### Scenario: Codex OAuth returns 5h and 7d

**Given** the current provider is `openai-codex` with a valid ChatGPT OAuth credential
**When** `/usage` runs
**Then** the result includes 5h and 7d remaining percentages and reset hints from `wham/usage`.

### Scenario: Account-switcher credential wins

**Given** the active account-switcher account has a Codex OAuth entry different from the bare `auth.json` default
**When** usage is fetched
**Then** the checker uses the active account’s credential and does not change account selection.

### Scenario: Missing chatgpt_account_id

**Given** an `openai` OAuth token without `chatgpt_account_id`
**When** `/usage` runs
**Then** Pi reports usage unavailable for that login without crashing or leaking the token.

### Scenario: Provider failure

**Given** `wham/usage` returns 401, 429, timeout, or malformed JSON
**When** `/usage` runs
**Then** Pi shows a concise safe failure with no credential material.

## 8. Automated verification

- `node --test extensions/usage/`
- `npm run check`

## 9. Definition of done

Codex/OpenAI OAuth usage uses `wham/usage`, resolves credentials through account-switcher then `auth.json`, exposes structured 5h/7d windows, keeps e05 safety rules, and passes focused tests without depending on `pi-multi-pass`.

## 17. Verification Script

1. Run `node --test extensions/usage/`.
2. Run `npm run check`.
3. With a non-secret fixture for a ChatGPT OAuth account, run `/usage` and verify it renders 5h and 7d windows without credential material.
