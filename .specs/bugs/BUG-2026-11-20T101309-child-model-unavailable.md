---
bug_id: BUG-2026-11-20T101309
status: open
severity: high
scope: subagent-account-runtime
title: Selected child model unavailable with account switcher
---

## Problem

The user reports subagent launches fail with `Selected child model is unavailable: cursor/auto`, including when different models are selected. Expected: use the approved account and model in an isolated child runtime. Reproduce with the installed pi-account-switcher and real configured account/model; test explicit, one-shot, and inherited selection without exposing credentials.

## Investigation so far (not a verified root cause)

- `extensions/subagent/account-runtime.ts` creates `ModelRuntime.create({ modelsPath: null })`, calls the published selection's `installOauth` with a new `ModelRegistry`, then looks up the descriptor's provider/model in that child runtime. The reported message is thrown when `getModel` returns no model.
- `/Users/kevin.oberlies/git/agents/pi-account-switcher/src/runtime/child-runtime-api.ts` publishes the descriptor and delegates `installOauth` to account-specific installation. Determine what this installs for Cursor and whether it registers custom provider/model definitions or only credentials.
- The null models path and `noExtensions: true` in child session setup are candidate causes of missing provider/model registration, but have not been tested against the user's actual runtime. Do not assume either is the cause.
- Existing `extensions/subagent/account-runtime.test.ts` uses synthetic selections that register provider definitions; it may not exercise the real plugin or Cursor. Test whether selected non-Cursor models actually reach the child descriptor, or whether `cursor/auto` is stale/inherited.
- Security: keep credential material isolated and never log or persist secrets. Risk is high because this crosses account and model authorization boundaries.

## Next steps

Reproduce and isolate with the actual installed Pi and account-switcher integration; check provider/model discovery and selection at the public boundary. Confirm root cause before choosing a fix. Write behavioral RED/GREEN changes separately and validate explicit/inherited/one-shot selection, custom providers, failed session creation, and credential isolation. Do not push or change account selection without user instruction.
