# e01s02 — Use Codex MCP through the shared registry

## 1. Identity
- **Story:** e01s02
- **Type:** refactor
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P0

## 2. User need
A Pi user needs existing Codex MCP tools to remain available while the shared MCP extension becomes independent of Codex.

## 3. Goal
Adapt the machine-local Codex extension as the first real registry provider, preserve its behavior, and retire the coupled machine-local `mcp.ts` only after integrated verification.

## 4. Non-goals
- Moving Codex implementation or secrets into this repository.
- Changing Codex transports, authentication, configuration parsing, or tool behavior.
- Adding new Codex capabilities.

## 5. Users
Pi users with machine-local Codex MCP configuration.

## 6. User journey
Pi loads the shared package and local Codex extension; Codex registers itself, existing tools work, and `/mcp` displays Codex-owned sections without shared-core knowledge of Codex.

## 7. Preconditions
- e01s01 is passing.
- The machine has the current Codex extension and its tests.

## 8. Inputs
Codex server configuration, provider status, discovered tool definitions, and lifecycle signals.

## 9. Outputs
Registry-contributed Codex tools and named status sections with preserved `/mcp-codex` behavior.

## 10. Requirements
### MODIFIED: Codex tool registration boundary
**Before:** `codex-mcp.ts` registers discovered tools directly with Pi and answers a Codex-specific status-request event.
**After:** `codex-mcp.ts` registers itself through the shared provider contract, contributes tools and status through that boundary, and unregisters by emitting the exact provider object rather than its string ID.

### MODIFIED: Shared MCP status command
**Before:** machine-local `mcp.ts` imports Codex types and configuration paths and formats Codex provider status directly.
**After:** the repository MCP extension renders generic provider-named sections and has no Codex reference.

### MODIFIED: Machine-local extension ownership
**Before:** both `mcp.ts` and `codex-mcp.ts` must remain machine-local because of their direct coupling.
**After:** only the work-specific Codex provider remains machine-local; the shared package owns `/mcp`.

## 11. Quality attributes
Behavior preservation, no duplicate tools or commands, and safe migration ordering.

## 12. Interfaces and contracts
The Codex provider must conform to the e01s01 contract while retaining its existing MCP server, command, and cleanup contracts.

**Reason for Depth:** A provider adapter is necessary because Codex owns asynchronous discovery and resources that cannot move into the provider-neutral registry.

## 13. State
Codex remains owner of clients, resources, statuses, and credentials. The registry receives only provider-facing tools and display-safe status data.

## 14. Dependencies
- `[OK] @earendil-works/pi-coding-agent` — existing extension API.
- Existing machine-local Codex modules; no new package.

## 15. Failure modes
Missing shared registry, failed Codex server, failed resource loading, duplicate registration, and shutdown during asynchronous loading must not crash Pi.

## 16. Observability
Codex provides its own generic section names and failure text; `/mcp-codex` continues to expose configured server names.

## 17. Acceptance criteria
### Scenario: Existing Codex tools remain available
**Given** healthy configured Codex MCP servers
**When** Pi loads the shared extension and Codex provider
**Then** the same discovered tools are callable through Pi.

### Scenario: Codex owns its presentation
**Given** the Codex provider has status
**When** the user invokes `/mcp`
**Then** Codex-provided named sections display without Codex logic in the shared extension.

### Scenario: Shared extension works without Codex
**Given** the Codex extension is absent
**When** Pi loads the package
**Then** `/mcp` remains available and startup succeeds.

### Scenario: Safe retirement of old command
**Given** shared and Codex integration tests pass together
**When** the old local `mcp.ts` is removed
**Then** there is one `/mcp` command and no duplicate MCP tools.

## 18. Automated verification
- `node --test "$HOME/.pi/agent/extensions/codex-mcp/tests/"*.test.ts`
- `npm run check`
- `pi --no-extensions -e . -e "$HOME/.pi/agent/extensions/codex-mcp.ts" --list-models >/dev/null`

## 19. Implementation steps
1. Add provider-boundary tests around the existing Codex extension → verify: `node --test "$HOME/.pi/agent/extensions/codex-mcp/tests/"*.test.ts`
2. Adapt Codex tool and section contribution and exact-provider-object disposal while preserving provider-owned resources → verify: `npm run check && node --test "$HOME/.pi/agent/extensions/codex-mcp/tests/"*.test.ts`
3. Verify combined startup before removing the coupled command → verify: `pi --no-extensions -e . -e "$HOME/.pi/agent/extensions/codex-mcp.ts" --list-models >/dev/null`
4. Remove old machine-local `mcp.ts` after replacement verification → verify: `test ! -f "$HOME/.pi/agent/extensions/mcp.ts" && ! grep -Rini --include='*.ts' 'codex' extensions/mcp`

## 20. Definition of done
Codex registers solely through the shared contract, existing Codex tests and package checks pass, combined Pi startup succeeds, the old local command is removed safely, and the shared extension remains Codex-free.
