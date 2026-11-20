# e20s04 — Shared-result rich /usage summary

## 1. Identity

- **Story:** e20s04
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 2
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

When the user runs `/usage`, they want a readable summary of the same structured quota data the footer uses — including both 5h and 7d windows — not a flat leftover of the e05 identity stub.

## 3. Goal

Upgrade `/usage` rendering to consume the shared quota result type from e20s01–e20s03: plan, email, structured windows (5h and 7d where applicable), reset hints, optional reset credits / extra-usage flags, and safe failures. Keep one source of truth with the footer.

## 4. Non-goals

- A full interactive TUI card browser like multi-pass `/subs limits` (scrollable multi-account cards).
- Mutating accounts or calling login flows from `/usage`.
- New provider HTTP beyond what e20s01–e20s03 already provide.

## 5. Requirements

### ADDED: Shared-result rendering

`/usage` shall render from the shared quota/usage result:

- Provider and account identity
- Plan / email when present
- Each structured window with remaining percent and reset hint
- For Codex/Anthropic: **both 5h and 7d** when returned
- Optional Codex reset-credits or Anthropic extra-usage notes when present
- Concise unsupported / missing-auth / error states

### ADDED: Parity with footer data

Given the same provider, account, and successful checker response, `/usage` and the footer must not disagree on remaining percentages for the same windows (allowing footer truncation for width only).

### MODIFIED: formatUsageSummary

Extend or replace `formatUsageSummary` so structured windows are first-class. Legacy rate-limit header fields may remain for API-key providers that still use them.

### RETAINED: e05 safety and accounts boundary

No credential leakage. No `/accounts:*` behavior changes.

## 6. Acceptance criteria

### Scenario: Codex /usage shows both windows

**Given** Codex OAuth returns 5h and 7d windows
**When** the user runs `/usage`
**Then** both windows appear with remaining percent and reset hints.

### Scenario: Anthropic /usage shows both windows

**Given** Anthropic OAuth returns 5h and 7d windows
**When** the user runs `/usage`
**Then** both windows appear; scoped weekly limits may appear as additional lines.

### Scenario: Google /usage uses structured buckets

**Given** a Google provider returns family/model remaining fractions
**When** the user runs `/usage`
**Then** those windows render without fake 5h/7d labels.

### Scenario: Footer and /usage agree

**Given** a successful shared checker result
**When** `/usage` and the footer both display that result
**Then** remaining percentages for each named window match.

### Scenario: Safe failure unchanged

**Given** the checker returns an error kind
**When** `/usage` renders
**Then** the message is concise and contains no secrets.

## 7. Automated verification

- `node --test extensions/usage/`
- `node --test extensions/usage/documentation.test.ts`
- `npm run check`

## 8. Definition of done

`/usage` renders rich shared quota results (including 5h and 7d for Codex/Anthropic), stays aligned with the footer, keeps e05 safety rules, updates documentation tests, and passes package checks.
