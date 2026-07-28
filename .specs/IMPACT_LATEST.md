# MCP Registry Gap-Closure Impact Assessment

## Target

- `extensions/mcp/registry.ts`: registration ownership, failure retention, and exact-instance disposal.
- `extensions/mcp/index.ts`: provider-unregister wire payload and `/mcp` failure rendering.
- `extensions/mcp/lifecycle.test.ts`: runtime replacement coverage and reliability threshold.
- Machine-local `~/.pi/agent/extensions/codex-mcp/provider-registry.ts`: provider-object unregister payload.
- Public guide and example: wire-contract documentation and copyable provider lifecycle.

## Zoom-out

### Purpose

The shared MCP module coordinates independently loaded providers, registers their tools, renders provider-owned status through `/mcp`, and removes only the state owned by a disposing provider instance.

### Callers

- Pi invokes `extensions/mcp/index.ts` from the package manifest.
- Repository providers call `registerMcpProvider`.
- Machine-local Codex uses the literal event-bus wire contract.
- Third-party providers copy the wire contract from `extensions/mcp/README.md` and `examples/mcp-provider/index.ts`.
- Registry, integration, lifecycle, failure-isolation, example, and Codex adapter tests exercise the contract.

### Contracts

- Registration is idempotent for the same provider object.
- Distinct objects with the same provider ID conflict visibly and cannot replace or remove the healthy owner.
- Unregistration is authorized by exact provider-object identity, not merely a shared string ID.
- Registration/status failures expose generic text and never provider-thrown secret content.
- Reload, new, resume, fork, and quit teardown leave no stale active tools.
- Registry behavior remains provider-neutral and adds no runtime dependency.

## Dependents (10)

- `extensions/mcp/index.ts`
- `extensions/mcp/registry.ts`
- `extensions/mcp/index.test.ts`
- `extensions/mcp/registry.test.ts`
- `extensions/mcp/failure-isolation.test.ts`
- `extensions/mcp/lifecycle.test.ts`
- `extensions/mcp/README.md`
- `examples/mcp-provider/index.ts`
- `~/.pi/agent/extensions/codex-mcp/provider-registry.ts`
- `~/.pi/agent/extensions/codex-mcp/tests/provider-registry.test.ts`

## Affected Stories

- `e01s01`: duplicate identity conflicts must be visible and disposal must preserve the healthy owner.
- `e01s02`: Codex must emit the revised provider-object unregister payload.
- `e01s03`: lifecycle replacement and 100-cycle reliability coverage must become explicit.
- `e01s04`: the public guide/example must teach the safe payload.

## Test Coverage

Existing coverage:

- Load-order independence and repeated readiness.
- Provider removal by ID.
- Tool-name conflict isolation.
- Generic status-failure redaction.
- Example shutdown cleanup.
- Codex adapter registration and ID-based disposal.

Required coverage:

- Duplicate provider identity appears as a generic `/mcp` failure.
- Disposing a rejected duplicate does not remove the healthy provider or its tools.
- Exact-instance disposal removes the accepted owner.
- Reload/new/resume/fork/quit runtime teardown and recreation remain duplicate-free.
- 100 replacement cycles leave zero stale or duplicate tools.
- Status collection for 100 synchronous providers completes in under 50 ms.
- Codex and authoring-example adapters emit provider objects on unregister.

## Risk: High

This changes a public cross-extension wire contract and tool ownership semantics across repository and machine-local callers; an incomplete migration can leave stale tools or let one provider remove another.

## Recommended action

Reopen `e01s01` and `e01s03`; update the Codex adapter and public example in the same change; use contract-first tests and the approved P0 NFR thresholds. Do not add dependencies.
