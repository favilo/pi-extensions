# e01 Test Plan — MCP Provider Registry

## Scope

P0 verification for the provider-neutral registry, its public event-bus contract, and lifecycle behavior across independently loaded extensions.

## Approved NFR thresholds

| Dimension | Threshold | Evidence |
| --- | --- | --- |
| Performance | Collect status from 100 synchronous providers in `< 50 ms` | Deterministic Node test using `performance.now()` around `getStatusSections()` |
| Reliability | 100 runtime replacement cycles produce zero stale or duplicate active tools | Lifecycle harness repeatedly tears down and recreates registry/provider runtimes |
| Operability | Registration and status failures remain visible without provider-thrown secret text | `/mcp` integration and failure-isolation assertions |

## P0 scenarios

### SC-e01s01-P0-01 — Duplicate identity visibility

Given a healthy provider and a distinct provider object with the same ID, registering the duplicate must retain the healthy provider and display a generic failure through `/mcp` without thrown details.

### SC-e01s01-P0-02 — Exact-instance disposal

Disposing a rejected duplicate must clear only its failure record. It must not remove the accepted provider, deactivate its tools, or suppress its status. Disposing the accepted provider must remove only that provider's state.

### SC-e01s01-P0-03 — Status collection performance

Register 100 synchronous providers, collect all status sections once, assert 100 sections, and assert elapsed collection time is below 50 ms.

### SC-e01s03-P0-01 — Runtime replacement semantics

For `reload`, `new`, `resume`, `fork`, and `quit`, teardown removes the old runtime's tools. Replacement reasons recreate one provider registration with no duplicates.

### SC-e01s03-P0-02 — Reliability soak

Run 100 teardown/recreation cycles against a shared event bus and assert each cycle has exactly one active provider tool and no stale listeners or duplicate registration.

### SC-e01s03-P0-03 — Failure operability

Provider registration and status failures render generic provider-named failure sections; healthy provider tools/status remain available; synthetic secret text never appears.

## Test levels

- Unit: registry ownership, conflict retention, status collection timing.
- Integration: registry command plus provider event-bus handshake.
- Lifecycle: repeated runtime teardown/recreation through the fake Pi harness.
- External adapter regression: package checks plus machine-local Codex tests.

## Fixture strategy

Use deterministic in-memory providers and event buses. No network, credentials, configuration, timers, or real MCP server is allowed. The performance scenario measures synchronous registry overhead only and performs no logging inside the timed region.
