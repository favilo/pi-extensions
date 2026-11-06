# e18s00 — Re-evaluate pi-oxidized and pi-oxidized-ext

## 1. Identity
- **Story:** e18s00
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P1
- **Delta:** ADDED

## 2. User need
The published Rust Pi crates may be a better host than the standalone NAPI package. The epic should record that choice before path trust, prompts, and tool execution move.

## 3. Goal
Record an adopt or reject decision for using `pi-oxidized-ext` as the tool-permissions extension host. `pi-oxidized` is the product runtime. `pi-oxidized-ext` is the crate that exposes `pi_ext`.

## 4. Non-goals
- Moving path trust, audit writes, rule saves, prompts, or tool execution in this story.
- Deleting `extensions/tool-permissions/index.ts`.
- Discarding the current `wasm32-wasip1-threads` package before the decision is reject or adopt.
- Treating the historical spelling `pi-oxided` as a package name.

## 5. Users
Maintainers choosing the host for the WASM-only extension.

## 6. User journey
A maintainer reads the current crates.io releases, tries the smallest registration probe against `pi-oxidized-ext`, and lands one decision: later e18 stories switch to that host, or they stay on the standalone NAPI package.

## 7. Preconditions
- e16s05 through e16s07 are passing on the standalone NAPI package.
- crates.io publishes `pi-oxidized` and `pi-oxidized-ext`. Both are [OK] for this evaluation.

## 8. Inputs
Current crate versions, their extension registration API, and the Pi callbacks tool-permissions needs: `pi.on`, prompt UI, and a tool execution callback.

## 9. Outputs
A decision record at `.specs/epics/e18-wasm-only-tool-permissions/e18s00-pi-oxidized-decision.md` with `decision: adopt` or `decision: reject`, the inspected versions, and the constraint that forced the choice.

## 10. Requirements
#### ADDED: The host decision is explicit
The decision record names `pi-oxidized` and `pi-oxidized-ext`, their inspected versions, and exactly one of `decision: adopt` or `decision: reject`.

#### ADDED: Later stories follow the record
`decision: adopt` means e18s01 and later use `pi-oxidized-ext` as the host. `decision: reject` means they keep the current NAPI package and flavor `wasm32-wasi`.

## 11. Quality attributes
Evidence before commitment, and no second permission engine added by the probe.

## 12. Interfaces and contracts
The probe may call the published `pi_ext` registration surface. It must not authorize a tool call. A failed compile or load is a valid reject reason.

## 13. State
The decision record is the only persistent output. The probe does not change user `permissions.toml` or the audit log.

## 14. Dependencies
- crates.io crates `pi-oxidized` and `pi-oxidized-ext`.
- Current NAPI loader, kept intact until a later story applies an adopt decision.

## 15. Failure modes
The record spells the crate name wrong, omits the version, or says adopt without a successful registration probe. A reject omits the blocking API constraint.

## 16. Observability
The decision file quotes the crate version and the probe result. The test fails when the file is missing or the decision value is neither adopt nor reject.

## 17. Acceptance criteria
### Scenario: Adopt names a working host
**Given** `pi-oxidized-ext` can register a Pi callback from this package
**When** the decision record is written
**Then** it says `decision: adopt`, names the inspected versions, and later stories are required to use that host.

### Scenario: Reject names the blocker
**Given** the crate cannot host the extension without a new runtime or an unsupported WASM target
**When** the decision record is written
**Then** it says `decision: reject` and names the blocking constraint. Later stories stay on the current NAPI package.

## 18. Automated verification
- `node --test extensions/tool-permissions/native-pi-oxidized-decision.test.ts`
- `npm run check`

## 19. Implementation steps
1. Add a failing test that requires the decision record to name both crates and to say adopt or reject. → verify: `node --test extensions/tool-permissions/native-pi-oxidized-decision.test.ts`
2. Probe `pi-oxidized-ext` registration without authorizing a tool call, and record the version plus the result. → verify: `node --test extensions/tool-permissions/native-pi-oxidized-decision.test.ts`
3. Write `.specs/epics/e18-wasm-only-tool-permissions/e18s00-pi-oxidized-decision.md` with one decision. → verify: `node --test extensions/tool-permissions/native-pi-oxidized-decision.test.ts`
4. Run full checks. No new security findings in affected paths. → verify: `npm run check`

## 20. Definition of done
The epic has one written host decision. e18s01 does not start against an unexamined `pi-oxidized-ext`.
