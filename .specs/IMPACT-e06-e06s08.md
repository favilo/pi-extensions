# Impact Analysis — e06s08 Export compact or complete subagent context

## Target
The public `subagent_result` contract and its retained child runtime in `extensions/subagent/index.ts`, `extensions/subagent/background-lifecycle.ts`, `extensions/subagent/background-events.ts`, and `extensions/subagent/result-renderer.ts`, plus write-policy classification in `extensions/tool-permissions/index.ts`.

## Dependents (8)
- `extensions/subagent/index.ts`: registers, executes, and renders `subagent_result`.
- `extensions/subagent/background-lifecycle.ts`: owns retained child status, output, events, session disposal, and result lookup.
- `extensions/subagent/background-session.test.ts`: asserts active, terminal, stable, bounded, and cross-registry result behavior.
- `extensions/subagent/result-renderer.ts`: currently expands event-rich snapshots and applies presentation bounds.
- `extensions/subagent/result-renderer.test.ts`: asserts collapsed nondisclosure and expanded presentation limits.
- `extensions/subagent/index.test.ts`: asserts tool schema, registration, and result rendering.
- `extensions/tool-permissions/index.ts`: classifies and prompts custom tool calls; export adds a filesystem mutation variant.
- `extensions/tool-permissions/index.test.ts`: proves configured custom-tool policy and protected tool-family routing.

## Affected Stories
- e06s05 — the current result API and bounded live event buffer remain lifecycle foundations, but its model-facing result shape is narrowed.
- e06s06 — live transcript panels must continue consuming the bounded in-memory normalized event contract, not the untruncated export path.
- e06s07 — launch/runtime selection shares `extensions/subagent/index.ts`; its approval and account isolation behavior must remain unchanged.
- e06s08 — owns compact default retrieval and explicit full-context persistence.

## Test Coverage
- `extensions/subagent/background-session.test.ts`: current active/terminal lookup, stable repeated retrieval, retention, and UTF-8 output bounds.
- `extensions/subagent/background-events.test.ts`: current normalized live-buffer ordering, reasoning exclusion, coalescing, sealing, and memory bounds.
- `extensions/subagent/result-renderer.test.ts`: collapsed output nondisclosure and expanded presentation limits.
- `extensions/subagent/index.test.ts`: public tool registration and renderer integration.
- `extensions/tool-permissions/index.test.ts`: configured custom tools and shared policy routing.
- `extensions/tool-permissions/prompt-queue.test.ts`: immutable FIFO prompt identity and write-policy behavior.
- Gap: no test currently covers complete SessionManager-to-export normalization, untruncated streaming serialization, canonical arbitrary destinations, atomic no-clobber/overwrite publication, restrictive file mode, or cancellation cleanup.

## Risk: High
This changes a shared model-facing tool contract and deliberately creates a second user-selected durable copy of secret-bearing child context. It spans lifecycle retention, permission classification, canonical filesystem identity, atomic replacement, and shutdown cancellation.

## Recommended action
Proceed only through behavioral RED/GREEN slices. Keep live display memory-bounded, use Pi's existing child SessionManager as the export source, require shared write authorization on the exact canonical target, and complete the pending e06s05 security fixes before implementing e06s08.

## WSJF
Provisional story WSJF: `(business value 7 + time criticality 5 + risk reduction 8) / job size 4 = 5.0`. It outranks the 4.8 observable-background increment but remains below e07's provisional 5.5; explicit user priority places story planning before the e06s05 security repair and implementation after that repair.
