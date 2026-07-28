# e01s01 — Use a provider-neutral MCP registry end to end

## 1. Identity
- **Story:** e01s01
- **Type:** feat
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P0

## 2. User need
A Pi user needs independently loaded MCP integrations to contribute tools and status without coupling the shared command to a particular provider.

## 3. Goal
Ship the thinnest end-to-end path in which a provider registers, contributes a callable tool and named status section, and appears through `/mcp`.

## 4. Non-goals
- Real MCP transports or authentication.
- Codex-specific adaptation.
- Provider package discovery or installation.

## 5. Users
- Pi users consuming MCP tools.
- Pi extension authors implementing MCP providers.

## 6. User journey
Pi loads the shared extension and a provider in either order; the provider becomes available, its tool is callable, and `/mcp` displays its named section.

## 7. Preconditions
- Pi loads this repository as a package.
- A provider extension follows the public registry contract.

## 8. Inputs
Provider identity, contributed Pi-compatible tool definitions, and provider-owned named status sections.

## 9. Outputs
Callable provider tools, deterministic `/mcp` output, and visible provider registration failures.

## 10. Requirements
### ADDED: Provider-neutral MCP registry
The shared extension shall accept independently loaded MCP providers without provider-specific imports, names, paths, types, or presentation logic.

### ADDED: Tool contribution
A registered provider shall be able to contribute callable MCP tools through the registry.

### ADDED: Named status sections
A provider shall be able to contribute one or more generically rendered, provider-named status sections.

### ADDED: Empty registry behavior
The `/mcp` command shall remain available and useful when no provider is registered.

### MODIFIED: Provider ownership and conflict visibility
**Before:** Unregistration identified an owner only by provider ID, and a duplicate identity rejection was returned internally but omitted from `/mcp`.

**After:** Registration and removal are authorized by exact provider-object identity. A rejected duplicate identity remains visible as a generic `/mcp` failure until that exact rejected provider disposes, and its disposal cannot remove or deactivate the accepted provider.

## 11. Quality attributes
- Deterministic registration and output.
- Provider-neutral core.
- Strict TypeScript contract.
- No new runtime dependency.

## 12. Interfaces and contracts
The public contract covers provider identity, tools, status sections, registration acknowledgment, and disposal. Duplicate announcements from the same provider instance must be idempotent. Unregistration carries that same provider object so the registry can enforce exact-instance ownership. Conflicting identities or tool names must become visible generic registration failures rather than overwrite or remove healthy registrations.

**Reason for Depth:** Separately loaded extensions need a stable coordination boundary that survives arbitrary load order; inline direct imports cannot provide that boundary without restoring provider coupling.

## 13. State
Registry state is session-runtime state only. It must not persist credentials, provider data, or tool results.

## 14. Dependencies
- `[OK] @earendil-works/pi-coding-agent` — existing peer dependency and authoritative extension API.
- No new external package.

## 15. Failure modes
Malformed providers, duplicate identities, duplicate tool names, and status callbacks that throw are reported without crashing Pi or corrupting healthy registrations.

## 16. Observability
`/mcp` reports provider-named sections and registration/status failures without exposing secrets.

## 17. Acceptance criteria
### Scenario: No provider is installed
**Given** Pi loads the shared MCP extension alone
**When** the user invokes `/mcp`
**Then** the command reports that no MCP providers are registered and Pi remains healthy.

### Scenario: Provider contributes an end-to-end capability
**Given** a conforming provider registers a tool and named section
**When** Pi completes registration
**Then** the tool is callable and `/mcp` displays the provider section.

### Scenario: Multiple providers coexist
**Given** two providers register distinct tools and sections
**When** the user invokes `/mcp`
**Then** both sections display and both providers' tools remain callable.

### Scenario: Conflicting registration
**Given** a distinct provider object conflicts with an existing identity or tool name
**When** it registers
**Then** `/mcp` reports a generic conflict and the healthy registration remains intact.

### Scenario: Rejected duplicate disposes
**Given** a duplicate provider identity was rejected while the accepted provider remains healthy
**When** the rejected provider disposes
**Then** only its failure record is removed and the accepted provider's tools and status remain active.

### Scenario: Registry status performance
**Given** 100 synchronous providers are registered
**When** their status sections are collected
**Then** all 100 sections are returned in less than 50 ms.

## 18. Automated verification
- `node --test extensions/mcp/registry.test.ts`
- `node --test extensions/mcp/index.test.ts`
- `npm run check`
- `node --test --test-name-pattern='100 synchronous providers' extensions/mcp/registry.test.ts`
- `node --test "$HOME/.pi/agent/extensions/codex-mcp/tests/provider-registry.test.ts"`

## 19. Implementation steps
1. Preserve the passing zero, one, multiple, idempotent, and tool-conflict contract tests → verify: `node --test extensions/mcp/registry.test.ts`
2. Add RED tests for duplicate identity visibility and rejected-duplicate disposal, then enforce exact provider-instance ownership in the registry and `/mcp` path → verify: `node --test extensions/mcp/index.test.ts extensions/mcp/failure-isolation.test.ts`
3. Preserve the provider-neutral package surface and TypeScript source boundary → verify: `npm run typecheck && ! grep -RinE --include='*.ts' 'codex|CODEX_CONFIG_PATH|codex-mcp' extensions/mcp`
4. Preserve the complete package regression baseline → verify: `npm run check`
5. Migrate the README, example provider, and machine-local Codex adapter to unregister with the exact provider object → verify: `npm run check && node --test "$HOME/.pi/agent/extensions/codex-mcp/tests/provider-registry.test.ts"`
6. Add the approved 100-provider status performance scenario → verify: `node --test --test-name-pattern='100 synchronous providers' extensions/mcp/registry.test.ts`

## 20. Definition of done
All acceptance scenarios pass, rejected duplicate disposal cannot affect the accepted owner, 100-provider status collection stays below 50 ms, the extension is explicitly package-loaded, no Codex-specific TypeScript reference exists under `extensions/mcp/`, and all tasks are marked passing only after their commands exit successfully.
