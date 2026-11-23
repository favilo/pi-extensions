# e23s01 — Message another running Pi session

> Outline only. Fill countable plan details via `plan-work` in a later session.

## 1. Identity

- **Story:** e23s01
- **Type:** feature
- **Maturity:** 2 — Outline
- **BCPs:** 5
- **Risk:** P1
- **Delta:** ADDED

## 2. User need

An agent working in one project directory needs a safe way to message another independently running Pi session — either steering an active turn or queuing a follow-up.

## 3. Goal

- Add a tool that identifies the target session and chooses steer-active vs queue-follow-up.
- Make target and message visible for approval.
- Report whether the message was accepted or the session was unavailable.
- Preserve session isolation; do not write directly to another session's transcript.

## 4. Non-goals

- Shared memory or joint tool execution across sessions.
- Parallel subagent UI (e24).

## 5. Acceptance criteria (outline)

- Approved messages reach the identified live session as steer or queued follow-up.
- Unavailable targets return a clear unavailable result without partial writes.
- Denial leaves the target session unchanged.
- No direct foreign-transcript mutation.

## 17. Verification Script

1. Run focused cross-session messaging tests.
2. Run `npm run check`.
3. Start two isolated sessions; send an approved message to the target and verify it steers an active turn or starts an idle turn without leaking other session state.
