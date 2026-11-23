# Impact — e19s04 Rust lifecycle and authorization

## Target

Move `handleRegisteredToolCall`, `handleRegisteredToolResult`, session startup and shutdown behavior from `extensions/tool-permissions/index.ts` to Rust-owned callbacks, retaining Pi-visible outcomes.

## Dependents and boundaries

- `native-registration-loader.ts` and native `registration.rs` currently forward registered events to the TypeScript bridge; callback order and failure handling are security boundaries.
- `index.ts` dispatches read/search, write/edit, bash, subagent, export and other tool families, and owns prompt cancellation, steering, preview state and session cleanup.
- `bash-subcommands.ts`, `permission-boundary.ts`, path trust, policy, audit, and native prompt queue participate in authorization; child requests use the same permission boundary.
- e19s05 retains interactive prompt/editor/renderer behavior; e19s06 retains loader cleanup. Migrating callbacks must not remove those surfaces prematurely.

## Coverage and gaps

- `index.test.ts`, `native-registration.test.ts`, `permission-boundary.test.ts`, `native-prompt-queue.test.ts`, and `steering-context.test.ts` cover portions of registration, authorization, cancellation, and invocation-bound steering.
- Existing coverage exercises production behavior through the TypeScript bridge; add tests proving Rust-owned handlers preserve outcomes before replacing any route.
- Include malformed Pi payloads, cancellation and late results, missing host capabilities, audit failure, main/child attribution, result annotation, and shutdown. Preserve no-UI and policy/path fail-closed behavior.

## Risk: High

This is a shared, security-sensitive authorization boundary. A partial migration or incorrectly wrapped handler could silently allow a tool, lose audit records, or bind steering to the wrong invocation. Use small vertical RED/GREEN slices and preserve existing production routing until each replacement has parity evidence.
