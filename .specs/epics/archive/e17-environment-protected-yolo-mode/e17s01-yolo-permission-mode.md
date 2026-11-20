# e17s01 — Environment-gated YOLO permission policy mode

## 1. Identity
- **Story:** e17s01
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
When running Pi inside an isolated environment (such as a Docker container or CI runner), requiring interactive permission prompts for tool calls (read, write, edit, bash, subagent, custom tools) blocks non-interactive automation. Users need a YOLO mode enabled via an environment variable (`PI_YOLO_MODE=1` or `PI_PERMISSION_YOLO=1`) for a single Pi session to bypass all interactive prompts and automatically allow tool calls.

## 3. Goal
Check for an explicit environment variable gate (e.g. `PI_YOLO_MODE=1` or `PI_PERMISSION_YOLO=1`) during tool permission resolution. When set, bypass interactive user prompts and return `decision: "allow"` for all tool requests while preserving audit logging.

## 4. Non-goals
- Permanent global config modification without an environment variable gate.
- Disabling audit logging.
- Allowing unsafe execution when the environment variable is not explicitly set.

## 5. Requirements
- Gate YOLO mode behind explicit environment variables: `PI_YOLO_MODE=1` or `PI_PERMISSION_YOLO=1`.
- When enabled, resolve `decision: "allow"` for all tool calls (read, write, edit, bash, subagent, custom tools) without prompting the user.
- Explicit `deny` policy rules in `permissions.toml` still take precedence over YOLO mode if configured.
- Audit log records all executed tool calls with `decision: "allow_yolo"` or `decision: "allow_pattern"`.
- When the environment variable is unset or `0`, standard interactive policy and prompt logic applies unchanged.

## 6. Failure modes
Accidental enabling in non-container host environments, un-audited executions, or environment variable name typos.

## 17. Acceptance criteria
### Scenario: YOLO mode active via environment variable
**Given** `PI_YOLO_MODE=1` is set in the environment
**When** any tool call (bash, write, edit, subagent) is evaluated
**Then** the tool call is allowed automatically without presenting a permission prompt, and an audit record is logged.

### Scenario: Environment variable unset
**Given** `PI_YOLO_MODE` is unset or `0`
**When** a tool call requiring approval is evaluated
**Then** standard interactive permission prompts and policy checks execute.

## 18. Automated verification
- `node --test extensions/tool-permissions/yolo-mode.test.ts`
- `npm run check`

## 19. Definition of done
YOLO mode is gated by environment variable, automatically allows tool calls when active, logs audit entries, and defaults to standard permission prompts when inactive.
