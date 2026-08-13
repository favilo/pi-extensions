# Lightweight impact assessment — e06s05

## Target

- `extensions/subagent/agent-session.ts`
- `extensions/subagent/index.ts`
- `extensions/subagent/result-renderer.ts`
- Shared authorization boundary: `extensions/tool-permissions/permission-boundary.ts` and `extensions/tool-permissions/index.ts`

## Zoom-out map

### `extensions/subagent/agent-session.ts`

**Purpose:** Canonicalize a child cwd, construct the restricted Pi `AgentSession`, adapt child tool requests to the shared permission boundary, and currently own one invocation-scoped child turn through disposal.

**Callers:**

- `extensions/subagent/index.ts` creates and runs child sessions.
- `extensions/subagent/agent-session.test.ts` exercises creation, turn lifecycle, cancellation, and permission resolution.
- `extensions/subagent/permission-boundary.test.ts` exercises the restricted child surface and boundary adaptation.
- `extensions/subagent/working-directory.test.ts` exercises cwd containment.

**Contracts to preserve:**

- Canonical child cwd cannot escape the canonical parent cwd.
- A child receives only explicitly supplied custom tools; no direct SDK, process, shell, or MCP execution surface is exposed.
- Every child tool request is attributed with immutable child identity and enters `executeToolRequest()`.
- Abort and disposal are deterministic and idempotent.
- A supplied file-backed `SessionManager` remains the one Pi-owned durable child-message store; the new event buffer remains in memory.

### `extensions/subagent/index.ts`

**Purpose:** Register the public subagent tool, construct the parent-side tool catalog and permission bridge, resolve cwd and parent context, and create the child SDK session.

**Callers:**

- Pi loads the extension through `package.json` `pi.extensions`.
- The foreground model calls the registered `subagent` tool.
- `extensions/tool-permissions/index.ts` authorizes the foreground launch and bypasses duplicate interception only for the internal `subagent-tool-request` bridge.
- `extensions/subagent/index.test.ts` and `extensions/subagent/missing-ui.test.ts` exercise registration, bridge execution, and fail-closed prompting.

**Contracts to preserve:**

- Launch input remains schema-validated and cwd-bounded.
- The child bridge validates against the published parent tool schema, evaluates cwd-aware policy, prompts when required, executes, and audits exactly once.
- Missing UI, prompt cancellation, abort, or shutdown never becomes approval.
- The public launch returns only after lifecycle authority, cancellation, boundary, and subscription are installed.
- Result access is explicit and scoped to the current parent registry; no child output enters parent context before retrieval.
- `subagent_result` custom rendering is display-only: collapsed rows expose status/count/byte/truncation summary without output, while explicit Ctrl+O expansion uses valid pretty JSON capped to a presentation snapshot so retained 2 MiB results cannot flood the TUI.

### Shared tool-permission boundary

**Purpose:** Provide the single validate → evaluate → optional prompt → execute → audit authorization sequence for foreground and child tool requests.

**Callers:**

- `extensions/tool-permissions/index.ts` creates policy-backed boundaries.
- `extensions/subagent/agent-session.ts` adapts child requests.
- Subagent and tool-permission boundary tests directly verify denial, cancellation, validation, and execution behavior.

**Contracts to preserve:**

- Validation precedes policy evaluation and execution.
- Denial, missing UI, prompt cancellation, prompt error, and policy error fail closed.
- An allowed request executes at most once and retains child ID, cwd, tool name, and safe steering context.
- Audit receives decisions but background transcript events and raw secret-bearing tool data are not copied into new logs.

## Fan-in / dependents

There are 10 direct production, package-registration, and focused-test dependency edges across the three target boundaries. The runtime fan-in is narrow, but the permission interface is shared and security-critical.

## Fan-out / dependencies

The changed path depends on Node filesystem/path canonicalization, Pi `AgentSession` and `SessionManager`, Pi extension lifecycle and custom-message APIs, the published tool registry, TypeBox schema compilation, and the shared permission boundary.

Pi SDK detail verified from installed declarations:

- `AgentSession.subscribe(listener)` returns an unsubscribe function; Pi persists session messages internally on `message_end`.
- Published core events include `message_update`, `message_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `agent_end`, and `agent_settled`.
- `pi.sendMessage(message, { deliverAs: "steer", triggerTurn: true })` queues a completion signal during active work and starts a new parent turn when idle.
- `session_shutdown` distinguishes `quit`, `reload`, `new`, `resume`, and `fork`.

## Affected stories

- **e06s02:** Existing permission-enforced child execution must remain the only tool path.
- **e06s03:** Child cwd resolution must remain canonical and policy evaluation must use that cwd.
- **e06s04:** Missing UI and cancelled prompts must remain fail-closed.
- **e06s05:** Owns background lifecycle, normalized events, explicit result access, notification, and cleanup.
- **e06s06:** Will consume the normalized event/registry contract and replace the temporary single-active-child restriction with keyed FIFO prompt serialization.
- **e07s01:** Paused; it later changes Bash policy evaluation behind the same boundary, so e06s05 must not fork that evaluator.

## Existing test coverage and gaps

**Covered:**

- `extensions/subagent/agent-session.test.ts`: child creation, inherited context, abort, failure disposal, and policy resolver routing.
- `extensions/subagent/index.test.ts`: launch registration, restricted child tool catalog, deny/allow execution behavior.
- `extensions/subagent/permission-boundary.test.ts`: no direct process surface, schema rejection, actor/cwd preservation.
- `extensions/subagent/missing-ui.test.ts`: unavailable UI and prompt cancellation fail closed.
- `extensions/subagent/working-directory.test.ts`: canonical cwd containment.
- `extensions/tool-permissions/permission-boundary.test.ts`: shared authorization sequencing.

**Gaps requiring test-first coverage:**

- Immediate launch without awaiting child completion.
- Generated collision-resistant IDs and cross-registry isolation.
- Ordered normalized event sequencing, partial updates, byte/count bounds, explicit truncation, and late-event rejection.
- Atomic terminal sealing and stable repeated result snapshots.
- Temporary single-active prompt-capable child restriction.
- Waiting-for-permission state and immutable request identity.
- Fixed next-turn completion notification with no trigger and no child-authored content.
- Shutdown/reload/new/resume/fork abort, unsubscribe, bounded wait, disposal, and stale-callback rejection.
- Proof that raw events do not enter audit/debug logs, completion signals, or parent context before explicit retrieval.
- Renderer registration honors Pi's `expanded` option, keeps collapsed output hidden, pretty-prints/highlights expanded details, and marks presentation truncation while bounding events, payloads, output, and total JSON.
- Main-versus-child and child-versus-main prompt overlap through one session-owned FIFO presentation seam, with exact-request cancellation, prompt-error, shutdown, and no-double-settlement coverage.
- Child parity with main cwd-aware permission semantics, including in-cwd read/search auto-allow, configured allow/deny precedence, and `.aiignore` denial.

## Numeric risk score: 7 / 10

- **Fan-in: 3 / 4** — multiple direct callers/tests and a shared security interface, but only one production launch extension.
- **Fan-out: 3 / 3** — SDK session/events, lifecycle, persistence, tool registry, schema validation, and authorization all participate.
- **Recent churn: 1 / 3** — one relevant consolidated change appears in the last 20 ancestors for each target path.

The score does not exceed the mandatory `grill-me` threshold. Qualitative risk remains **High** because the change extends execution beyond invocation lifetime across an authorization boundary. Manual UAT subsequently proved the shared prompt UI is also a direct dependent: main and child prompt callers can overlap even while only one child is active.

## Recommended action

Proceed with test-first implementation only. Introduce a parent-session-owned registry because launch, result lookup, notification, and shutdown need one lifecycle authority (**Reason for Depth:** without one owner, stale callbacks and detached authorization cannot be sealed consistently). Normalize SDK events behind a project contract because e06s06 UI and result retrieval must not depend directly on unstable provider/SDK payloads (**Reason for Depth:** one bounded adapter centralizes ordering, secret handling, and terminal sealing). Keep the shared permission evaluator unchanged and preserve Pi's existing child `SessionManager` as the sole durable transcript store.
