---
bug_id: BUG-2026-11-19T165747
status: open
severity: medium
scope: tool-permissions-edit-write-errors
title: Preserve underlying path failure in blocked tool messages
---

## Problem

A blocked edit or write prefixes a path-resolution exception with internal native path-trust terminology. The user should see `Blocked <tool>: <underlying error>` instead. Malformed results must still fail closed with an honest diagnostic.

## Root Cause Analysis

Reproduce: a path-trust callback throwing `Error("disk unavailable")` is reported as `Native path trust failed: disk unavailable` before the blocked-tool prefix is applied.

Isolate: the adapter adds the extra prefix while catching the exception; the tool boundary already supplies `Blocked <tool>:`. The exception message is available at that boundary.

Hypothesis and verification: the catch branch constructs the prefix directly; changing only that branch preserves the failure and removes the unwanted internal wording. Malformed responses have no underlying exception and require a separate safe fallback.

Security impact: LOW; preserve fail-closed behavior and do not invent underlying errors. No security exploit path identified.

## TDD Fix Plan

1. RED: verify a thrown path-resolution error appears unchanged in the public adapter diagnostic. GREEN: return the caught error message without the internal prefix. Verify: `npx tsx --test extensions/tool-permissions/native-path-trust.test.ts`.
2. Verify blocked edit/write retain their existing blocked prefix and malformed native responses still deny. Run `npm run check`.

## Resolution so far

The path-trust adapter now preserves an underlying exception without the redundant native prefix (RED `1b230149`, GREEN `ce5d4810`). The original reported edit/write failure has not been reproduced; keep this bug open until the actual path and parity are verified.

## Acceptance Criteria

- Underlying errors are not obscured by native path-trust terminology.
- Invalid responses still fail closed with an honest fallback.
- Focused tests and project checks pass.
