# e01s03 — Keep MCP providers isolated across failures and lifecycle changes

## 1. Identity
- **Story:** e01s03
- **Type:** feat
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P0

## 2. User need
A Pi user needs one broken MCP integration or lifecycle transition to leave Pi and healthy integrations usable.

## 3. Goal
Prove load-order independence, idempotent cleanup, and provider/server failure isolation at the shared boundary.

## 4. Non-goals
- Provider-specific retries or recovery policy.
- Restarting failed MCP servers.
- Persisting registry state across Pi runtimes.

## 5. Users
Pi users running multiple MCP providers and extension authors debugging failures.

## 6. User journey
Pi loads providers in any order, reports isolated failures through `/mcp`, continues serving healthy tools, and reloads without stale or duplicate registrations.

## 7. Preconditions
The e01s01 registry contract exists and at least two test providers can register.

## 8. Inputs
Provider announcements, registration disposal, status failures, session lifecycle events, and individual provider-owned server failures.

## 9. Outputs
Stable healthy tools and sections, visible isolated errors, and clean post-lifecycle registry state.

## 10. Requirements
### ADDED: Load-order independence
Provider availability shall be equivalent whether the registry or provider extension loads first.

### MODIFIED: Lifecycle cleanup
**Before:** Provider removal was covered, but reload, replacement, and shutdown shared one broad verify pattern without explicit scenario coverage.

**After:** Reload, new, resume, fork, quit, and provider disposal are exercised explicitly; runtime recreation leaves exactly one current registration and no stale or duplicate tools.

### ADDED: Provider failure isolation
A provider that throws or returns invalid contributions shall be reported without preventing healthy providers from operating.

### ADDED: Server failure isolation
A provider shall be able to report one failed MCP server while retaining healthy servers and tools.

## 11. Quality attributes
Fault isolation, idempotence, deterministic cleanup, and actionable error visibility.

## 12. Interfaces and contracts
The registry-provider handshake must support announcement from either side. Disposal removes provider visibility and deactivates its contributed tools for the current runtime.

**Reason for Depth:** Bidirectional discovery and explicit disposal are required because Pi does not guarantee extension load order and providers own asynchronous resources with independent failure states.

## 13. State
Each registration has one runtime owner and one idempotent disposal path. Runtime teardown clears all registry references.

## 14. Dependencies
- `[OK] @earendil-works/pi-coding-agent` lifecycle and shared event APIs.
- No new external package.

## 15. Failure modes
Provider factory throw, section callback throw, conflicting identity/tool, late asynchronous contribution, disposal during loading, repeated reload, and one failed server among healthy servers.

## 16. Observability
`/mcp` identifies the failing provider or provider-owned server while continuing to render healthy sections.

## 17. Acceptance criteria
### Scenario: Provider loads first
**Given** a provider extension loads before the registry
**When** the registry becomes available
**Then** the provider registers once and its tool and section appear.

### Scenario: Registry loads first
**Given** the registry loads before a provider
**When** the provider announces itself
**Then** the same tool and section appear once.

### Scenario: Provider fails
**Given** one provider throws while another is healthy
**When** `/mcp` collects status
**Then** the failure displays and the healthy provider remains usable.

### Scenario: One server fails
**Given** one provider reports a failed server and a healthy server
**When** the provider contributes status and tools
**Then** the failed server displays while healthy server tools remain callable.

### Scenario: Runtime reloads or replaces a session
**Given** providers are registered
**When** Pi emits shutdown for reload, new, resume, or fork and creates a replacement runtime
**Then** old registrations are disposed and exactly one current registration appears without duplication.

### Scenario: Runtime quits
**Given** providers are registered
**When** Pi emits shutdown for quit
**Then** all provider tools and listeners owned by that runtime are removed.

### Scenario: Replacement reliability soak
**Given** a shared event bus
**When** registry and provider runtimes are replaced 100 times
**Then** every cycle has exactly one active provider tool and no stale listeners or duplicate registrations.

## 18. Automated verification
- `node --test extensions/mcp/lifecycle.test.ts`
- `node --test extensions/mcp/failure-isolation.test.ts`
- `npm run check`
- `node --test --test-name-pattern='100 runtime replacement cycles' extensions/mcp/lifecycle.test.ts`

## 19. Implementation steps
1. Preserve reversed-load-order and repeated-readiness coverage → verify: `node --test --test-name-pattern='load order|duplicate' extensions/mcp/lifecycle.test.ts`
2. Add explicit reload, new, resume, fork, quit, removal, and recreation tests using runtime-scoped handlers → verify: `node --test extensions/mcp/lifecycle.test.ts`
3. Preserve provider and individual-server failure isolation → verify: `node --test extensions/mcp/failure-isolation.test.ts`
4. Preserve package and Codex regressions together → verify: `npm run check && node --test "$HOME/.pi/agent/extensions/codex-mcp/tests/"*.test.ts`
5. Add the approved 100-cycle replacement reliability scenario → verify: `node --test --test-name-pattern='100 runtime replacement cycles' extensions/mcp/lifecycle.test.ts`

## 20. Definition of done
Both load orders behave identically; reload, new, resume, fork, and quit are explicitly covered; 100 runtime replacement cycles leave no stale or duplicate registration; provider/server failures remain visible and isolated; and all regression commands pass.
