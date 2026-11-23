# e19 Test Plan — Rust Pi Event Orchestration

## Scope

This initial plan covers **e19s02 only**. Add scenarios and NFRs for later e19 stories before their implementation; this file is not a complete epic-wide test design.

## e19s02 P0 scenarios

| Scenario | Behavior | Level | Evidence |
| --- | --- | --- | --- |
| SC-e19s02-P0-01 | WASM async runtime progresses and FIFO decisions remain identity-bound | Real WASM integration | `extensions/tool-permissions/native-prompt-queue.test.ts` |
| SC-e19s02-P0-02 | Presenter errors, cancellation, shutdown, and late results fail closed | Real WASM and Pi callback integration | Same test file |
| SC-e19s02-P0-03 | Disposed and concurrent WASM instances do not transfer decisions | Real WASM integration in child process | Same test file |
| SC-e19s02-P0-04 | A presenter cannot be dispatched twice; old environment identity cannot remove a new one | Rust unit | `prompt_queue.rs` tests |

## NFR verification — e19s02

| Dimension | Gate | Evidence command |
| --- | --- | --- |
| Performance / liveness | Existing asynchronous queue tests with explicit 5-second timeouts finish within those limits; host disposal test finishes within 15 seconds. These are deadlock bounds, **not latency or throughput targets**. | `npm run build:native && npx tsx --test extensions/tool-permissions/native-prompt-queue.test.ts` |
| Reliability | All focused queue tests pass, including fail-closed cancellation, queue advancement, teardown, and stale-result isolation; Rust prompt queue tests pass. | Focused command above; `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml -p tool-permissions-native prompt_queue` |
| Operability | Runtime tracer settles via the generated loader and the full project quality gate exits successfully. | Focused command above; `npm run check` |

These thresholds derive from existing tests rather than an approved product SLO. They do not establish real-world latency, throughput, production observability, or post-disposal settlement of promises owned by a destroyed environment. User acceptance of the verification script does not imply acceptance of a new performance SLO.

## Fixtures and isolation

Tests use deferred promises and the built WASM loader. The disposal test uses a child process and independent loader instances; no external network or production credentials are required.
