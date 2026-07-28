# e01s04 — Build another provider from the MCP guide and mock example

## 1. Identity
- **Story:** e01s04
- **Type:** feat
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1

## 2. User need
Another Pi agent needs a direct, trustworthy path for creating a conforming provider without reverse-engineering registry internals or Codex-specific code.

## 3. Goal
Publish a dedicated MCP README and self-contained mock provider that together teach and verify the complete public authoring contract.

## 4. Non-goals
- A production transport or server.
- Credentials, networking, OAuth, or configuration parsing.
- Teaching Codex internals.

## 5. Users
Pi agents and human extension authors building MCP providers.

## 6. User journey
An author reads the MCP README, copies the mock provider shape, changes its identity/tools/sections, runs focused checks, and obtains a conforming provider.

## 7. Preconditions
The public registry contract from e01s01 is stable and lifecycle/failure behavior from e01s03 is specified.

## 8. Inputs
The public provider types and documented lifecycle expectations.

## 9. Outputs
A dedicated guide, a non-autoloaded mock provider, and executable example-contract tests.

## 10. Requirements
### MODIFIED: Dedicated MCP authoring guide
**Before:** The guide documented unregistration by provider ID string.

**After:** The guide requires unregistration with the exact provider object, explains the ownership guarantee, and continues to cover registration, tool contribution, named status sections, failures, lifecycle cleanup, testing, and package boundaries without requiring Codex knowledge.

### ADDED: Self-contained mock provider
The repository shall include a provider example that demonstrates a callable tool, healthy status, reported failure, and cleanup without external setup.

### ADDED: Agent-oriented sufficiency
The public guide and example shall expose all information needed to create a second conforming provider without reading private registry implementation details.

## 11. Quality attributes
Copyable, concise, provider-neutral, executable, and resistant to documentation drift.

## 12. Interfaces and contracts
The example consumes only the same public provider surface available to third-party extensions and must not rely on test-only registry internals.

**Reason for Depth:** A dedicated example is justified because cross-extension lifecycle and failure contracts are easy to misuse and cannot be communicated safely by a minimal type signature alone.

## 13. State
The example uses in-memory deterministic state and cleans it up through the documented provider lifecycle.

## 14. Dependencies
- `[OK] @earendil-works/pi-coding-agent` — existing extension API.
- No network, credentials, configuration, server process, or new package.

## 15. Failure modes
Stale documentation, example autoloading as a real provider, hidden test-only imports, external environmental dependency, or omission of cleanup/failure guidance.

## 16. Observability
The example's healthy and failed sections are visible through `/mcp`; its mock tool returns deterministic output.

## 17. Acceptance criteria
### Scenario: Agent authors a provider
**Given** a fresh Pi agent can read the MCP README and mock example
**When** it creates a second provider using only the documented public contract
**Then** contract checks accept the provider without requiring registry implementation access.

### Scenario: Example runs offline
**Given** no network, credentials, configuration, or MCP server
**When** the example tests run
**Then** its tool, healthy status, failure status, and cleanup behavior pass.

### Scenario: Example is not automatically loaded
**Given** the repository package manifest
**When** Pi loads the package normally
**Then** the mock provider is not loaded as a user extension.

## 18. Automated verification
- `node --test examples/mcp-provider/index.test.ts`
- `test -f extensions/mcp/README.md`
- `npm run check`

## 19. Implementation steps
1. Update the MCP authoring guide with exact-provider-object disposal and its ownership rationale → verify: `grep -qi 'provider object' extensions/mcp/README.md && grep -qi 'exact' extensions/mcp/README.md && grep -qi 'lifecycle' extensions/mcp/README.md`
2. Update the self-contained mock provider to emit its exact provider object during cleanup → verify: `node --test examples/mcp-provider/index.test.ts`
3. Add a contract-sufficiency test that treats the example as an external author would → verify: `node --test --test-name-pattern='machine-local|authoring example' examples/mcp-provider/index.test.ts`
4. Ensure the example is not package-autoloaded and run all checks → verify: `npm run check && ! grep -q 'examples/.*/index.ts' package.json`

## 20. Definition of done
The guide covers the full public contract, the example runs offline and uses no private internals, package loading excludes the example, and focused plus package-wide checks pass.
