# e18s05 — Move tool execution sequencing into WASM

## 1. Identity
- **Story:** e18s05
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 8
- **Risk:** P0
- **Delta:** MODIFIED

## 2. User need
After an allow decision, TypeScript still decides whether the underlying tool runs. That leaves a second implementation on the path from approval to effect.

## 3. Goal
WASM owns the sequence from a validated allow decision to one Pi tool execution, and from a deny decision to no execution.

## 4. Non-goals
- Spawning a shell, opening a socket, or reimplementing Pi tools inside WASM.
- Changing what an allowed tool does.
- Moving path trust, audit writes, rule saves, or prompts.
- Removing the TypeScript load-failure fallback. That is e18s06.
- Deleting `extensions/tool-permissions/index.ts`.

## 5. Users
People and agents who expect an allowed tool to run once and a denied tool not to run.

## 6. User journey
A permission decision is allow. WASM calls the Pi host execution callback once with the original tool request. A deny or an invalid decision returns before that callback.

## 7. Preconditions
- e18s01 through e18s04 define the WASM owners for trust, audit, saves, and prompts. This story can call those results. It does not reimplement them.
- e18s00 has recorded adopt or reject for `pi-oxidized-ext`. This story uses that host.
- Pi still exposes the tool execution callback the extension uses today.

## 8. Inputs
Validated decision, tool name, original tool input, and the host execution callback.

## 9. Outputs
One host execution for an allow. Zero executions for deny, ask cancellation, or invalid WASM output.

## 10. Requirements
#### MODIFIED: Execution owner
**Before:** e16s06 requires TypeScript to own tool execution after a permission decision.
**After:** On a successful WASM call, Rust sequences execution and invokes the Pi host callback. TypeScript does not invoke that callback a second time.

#### ADDED: Deny executes nothing
Deny, cancellation, and invalid native output produce zero host executions.

## 11. Quality attributes
Exactly-once execution for allow, fail closed for everything else, and no new process authority inside WASM.

## 12. Interfaces and contracts
The host supplies an execution callback. Rust may call it only after a validated allow. Tests fail if the module gains a direct process or network spawn for this story.

## 13. State
No new persistent state. Execution side effects remain the side effects of the Pi tool that was already going to run.

## 14. Dependencies
- Current permission-boundary execution tests.
- `.specs/security/epics/e18/THREAT_MODEL.md` threats 1, 2, and 6.

## 15. Failure modes
A deny still executes. An allow executes twice. WASM spawns the command itself. A host callback error is reported as success.

## 16. Observability
Tests count host callback invocations and record the decision that preceded each invocation.

## 17. Acceptance criteria
### Scenario: Allow executes once
**Given** a validated allow for a tool request
**When** WASM handles the request
**Then** the Pi execution callback runs once with that request.

### Scenario: Deny executes nothing
**Given** a deny, a cancelled ask, or an invalid WASM decision
**When** WASM handles the request
**Then** the Pi execution callback runs zero times.

### Scenario: Host execution failure is visible
**Given** an allow whose host callback returns an error
**When** WASM handles the request
**Then** the error is returned to Pi and is not replaced with a successful tool result.

## 18. Automated verification
- `node --test extensions/tool-permissions/native-tool-execution.test.ts extensions/tool-permissions/permission-boundary.test.ts`
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
- `npm run build:native && npm run check`

## 19. Implementation steps
1. Add failing tests for one execution on allow, zero executions on deny, and visible host errors. → verify: `node --test extensions/tool-permissions/native-tool-execution.test.ts extensions/tool-permissions/permission-boundary.test.ts`
2. Add the Rust execution sequence that calls only the host callback. → verify: `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
3. Route the success path through WASM and remove the duplicate TypeScript invocation. → verify: `node --test extensions/tool-permissions/native-tool-execution.test.ts extensions/tool-permissions/permission-boundary.test.ts`
4. Run the native build and full checks. No new security findings in affected paths. → verify: `npm run build:native && npm run check`

## 20. Definition of done
A successful allow executes the Pi tool once from WASM, and every non-allow executes it zero times. The WASM module does not spawn the tool itself.
