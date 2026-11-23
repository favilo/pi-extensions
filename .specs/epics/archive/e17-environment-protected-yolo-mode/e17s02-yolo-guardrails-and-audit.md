# e17s02 — Container & session environment protection guardrails

## 1. Identity
- **Story:** e17s02
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
Users running YOLO mode in containers need prominent session notifications and audit evidence confirming that YOLO permission mode is active, preventing silent or accidental execution in unintended host sessions.

## 3. Goal
Notify users on session startup when YOLO mode is active (`YOLO permission mode active (PI_YOLO_MODE=1)`), audit session startup in `audit.log`, and require explicit boolean env truthiness (`1`, `true`, `yes`).

## 4. Non-goals
- Disabling TUI notifications.
- Allowing non-truthy values (`0`, `false`, `no`, empty string) to trigger YOLO mode.

## 5. Requirements
- Parse `PI_YOLO_MODE` and `PI_PERMISSION_YOLO` strictly (`1`, `true`, `yes` case-insensitive).
- Emit a TUI notification / warning on session start when YOLO mode is active.
- Log a session startup audit event (`decision: "yolo_mode_activated"`) with environment attribution.
- Maintain full audit logging for every auto-allowed tool execution under YOLO mode.

## 17. Acceptance criteria
### Scenario: Startup notification & audit
**Given** `PI_YOLO_MODE=1` is set
**When** a Pi session starts
**Then** a notification announces YOLO permission mode is active, and an audit event is logged.

## 18. Automated verification
- `node --test extensions/tool-permissions/yolo-mode.test.ts`
- `npm run check`
