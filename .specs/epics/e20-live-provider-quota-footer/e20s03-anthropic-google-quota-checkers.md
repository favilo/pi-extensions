# e20s03 — Anthropic and Google quota checkers

## 1. Identity

- **Story:** e20s03
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

Users on Anthropic Claude subscriptions and Google Gemini CLI / Antigravity need the same real remaining-quota visibility that Codex gets, not identity-only stubs.

## 3. Goal

Add multi-pass-equivalent quota checkers for every remaining provider multi-pass supports beyond Codex/OpenAI: `anthropic`, `google-gemini-cli`, and `google-antigravity`. Wire them through the shared usage/footer adapters so `/usage` and the footer work for those providers.

## 4. Non-goals

- Depending on `pi-multi-pass`.
- Rate-limit pools, failover, or subscription provider registration.
- Fabricating 5h/7d windows for Google when the API returns model/family buckets instead.

## 5. Prior art

| Candidate | Source | Verdict | Notes |
|-----------|--------|---------|-------|
| multi-pass Anthropic checker | `ANTHROPIC_USAGE_ENDPOINT` + profile endpoint | extend | Port 5h/7d + weekly scoped limits (e.g. Opus). |
| multi-pass Google Gemini CLI | `retrieveUserQuota` | extend | Summarize bottleneck families. |
| multi-pass Antigravity | `fetchAvailableModels` quotaInfo | extend | Model-level remaining fractions. |

## 6. Requirements

### ADDED: Anthropic OAuth checker

- Call Anthropic OAuth usage (`https://api.anthropic.com/api/oauth/usage`) with the required OAuth beta header pattern from multi-pass.
- Emit structured windows for **5h** and **7d**, plus any weekly scoped model limits (for example `7d Opus`).
- Attach plan/email from the profile endpoint when available.
- Use the same credential resolution order as e20s01 (account-switcher `piAuth` then `auth.json`).

### ADDED: Google Gemini CLI checker

- Refresh/use the saved Google OAuth session as needed.
- Query Cloud Code Assist `retrieveUserQuota` and map buckets to structured windows (family/model labels + remaining percent + reset).
- Surface the worst remaining percent for footer coloring.

### ADDED: Google Antigravity checker

- Query Antigravity-compatible `fetchAvailableModels` endpoints with Antigravity-style headers.
- Map model `quotaInfo.remainingFraction` into structured windows; hide internal-only models that multi-pass excludes.

### ADDED: Footer and `/usage` integration

- When the current provider is Anthropic, the footer shows **5h and 7d** (and may append scoped windows if space allows without clutter; minimum is 5h + 7d).
- When the current provider is Google Gemini CLI or Antigravity, the footer shows provider-appropriate structured remaining windows from the checker (not invented 5h/7d).
- `/usage` uses the same checkers and safe-failure rules.

### RETAINED: Provider coverage parity with multi-pass

Supported quota providers after this story: `openai-codex`, `openai` (ChatGPT-account OAuth only), `anthropic`, `google-gemini-cli`, `google-antigravity`.

## 7. Acceptance criteria

### Scenario: Anthropic 5h and 7d

**Given** the current provider is `anthropic` with valid OAuth
**When** `/usage` or the footer refreshes
**Then** both 5h and 7d remaining windows are present when the API returns them.

### Scenario: Gemini family quotas

**Given** the current provider is `google-gemini-cli` with valid OAuth
**When** usage is fetched
**Then** remaining family/model windows from `retrieveUserQuota` are shown without inventing Codex-style 5h/7d labels.

### Scenario: Antigravity model quotas

**Given** the current provider is `google-antigravity` with valid OAuth
**When** usage is fetched
**Then** model-level remaining fractions are summarized safely.

### Scenario: Missing auth

**Given** no usable OAuth credential for the current Google or Anthropic provider
**When** usage is fetched
**Then** Pi reports missing-auth/unsupported safely.

### Scenario: No secret leakage

**Given** any Anthropic or Google checker failure
**When** the user-visible result renders
**Then** no access token, refresh token, or raw response body appears.

## 8. Automated verification

- `node --test extensions/usage/`
- `npm run check`

## 9. Definition of done

Anthropic, Google Gemini CLI, and Antigravity quota checkers match multi-pass provider coverage for usage, share credential resolution and result types with e20s01/e20s02, and pass focused tests without a multi-pass dependency.
