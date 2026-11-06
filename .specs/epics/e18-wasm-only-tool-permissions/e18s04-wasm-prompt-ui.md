# e18s04 — Move the prompt UI, steering editor, and prompt queue into WASM

## 1. Identity
- **Story:** e18s04
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 8
- **Risk:** P0
- **Delta:** MODIFIED

## 2. User need
Permission prompts, steering text, and queued tool calls are still orchestrated in TypeScript. Parallel requests can be applied to the wrong call if that state has two owners.

## 3. Goal
WASM owns prompt sequencing, steering text, and the prompt queue. It calls Pi's existing UI and editor widgets. It does not reimplement the terminal.

## 4. Non-goals
- A new prompt layout, new key bindings, or a WASM-owned terminal.
- Replacing Pi's Vim editor widget. Rust calls it and owns the submitted text.
- Moving path trust, audit writes, rule saves, or tool execution.
- Removing the TypeScript load-failure fallback. That is e18s06.
- Deleting `extensions/tool-permissions/index.ts`.

## 5. Users
People who approve, deny, or steer a permission prompt, including prompts that queue behind an open prompt.

## 6. User journey
An agent requests a protected tool and the decision is ask. WASM opens the existing Pi prompt, binds it to that tool-call id, accepts steering through the existing editor, and returns allow, deny, or steering for that same id. A second request waits in the WASM queue.

## 7. Preconditions
- e10 steering behavior and e09 invocation binding remain the user-visible contract.
- e18s00 has recorded adopt or reject for `pi-oxidized-ext`. This story uses that host.
- Pi still exposes the prompt and editor widgets the extension uses today.

## 8. Inputs
Tool-call id, prompt title and body, queued request order, editor keystrokes, and the existing allow, deny, and save actions.

## 9. Outputs
One decision or steering payload bound to the originating tool-call id. Queue order matches submission order.

## 10. Requirements
#### MODIFIED: Prompt owner
**Before:** e16s06 and e16s07 require TypeScript to own prompt queues, prompt rendering, and steering state.
**After:** On a successful WASM call, Rust owns the queue, the binding between a prompt and its tool-call id, and the steering text. Rust calls Pi UI and editor widgets to render them.

#### ADDED: Queue identity is preserved
Steering text and an allow or deny result apply only to the tool-call id that opened that prompt.

## 11. Quality attributes
Same visible prompt behavior, stable queue order, and no cross-request steering.

## 12. Interfaces and contracts
Rust calls host-supplied Pi UI operations for open, input, and close. The host validates that the returned tool-call id is one of the ids Rust was given. The WASM module does not read the terminal directly.

## 13. State
Queue and steering state are process-local and cleared on the existing session shutdown path. Saved rules remain the concern of e18s03.

## 14. Dependencies
- Current prompt-queue, prompt-input, and steering tests.
- e09 invocation binding and e10 editor behavior as oracles.
- `.specs/security/epics/e18/THREAT_MODEL.md` threat 5.

## 15. Failure modes
Steering from prompt A is applied to queued prompt B. Two prompts are open for one call. A cancelled prompt is recorded as allow. Pi UI failure is ignored.

## 16. Observability
Tests report tool-call id, queue position, decision, and steering text. A mismatch between prompt id and result id fails the test.

## 17. Acceptance criteria
### Scenario: A prompt returns a bound decision
**Given** an ask decision for one tool-call id
**When** the user allows, denies, or submits steering
**Then** WASM returns that result for the same tool-call id and the visible prompt matches the current copy and actions.

### Scenario: Queued prompts stay ordered
**Given** two ask requests submitted in order
**When** the first prompt is still open
**Then** the second request waits, and its steering cannot satisfy the first request.

### Scenario: UI failure denies
**Given** a Pi UI callback that fails
**When** WASM tries to open the prompt
**Then** the tool call is denied and is not left queued as an allow.

## 18. Automated verification
- `node --test extensions/tool-permissions/native-prompt-queue.test.ts`
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
- `npm run build:native && npm run check`

## 19. Implementation steps
1. Add failing tests for bound decisions, queue order, steering isolation, and UI failure. → verify: `node --test extensions/tool-permissions/native-prompt-queue.test.ts`
2. Add Rust queue and steering state that calls host Pi UI operations. → verify: `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
3. Route the success-path prompt through WASM. → verify: `node --test extensions/tool-permissions/native-prompt-queue.test.ts`
4. Run the native build and full checks. No new security findings in affected paths. → verify: `npm run build:native && npm run check`

## 20. Definition of done
Successful prompts, steering text, and queue order are owned by WASM and rendered through Pi. The visible actions and copy stay the same.
