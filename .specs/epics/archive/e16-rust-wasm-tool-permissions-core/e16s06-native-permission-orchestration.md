# e16s06 — Port permission orchestration helpers to the native Rust core

## 1. Identity
- **Story:** e16s06
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 4
- **Risk:** P0
- **Delta:** ADDED

## 2. User need
Maintainers need more of the security-sensitive, pure permission computation to live behind the native Rust boundary without moving prompts, filesystem mutation, audit writes, or tool execution out of the TypeScript host.

## 3. Goal
Port deterministic permission orchestration helpers to Rust: permission-key mapping, structured input normalization, generic allow/deny/ask decision selection, and audit-ready decision metadata for non-Bash tool families.

## 4. Non-goals
- Registering Pi callbacks from Rust; that is covered by e16s07.
- Moving prompt UI, policy persistence, audit file writes, editor flows, or actual tool execution into Rust.
- Changing existing permission policy syntax or user-visible prompts.

## 5. Users
Tool-permissions maintainers and users relying on read/write/edit/subagent/custom-tool policy behavior.

## 6. User journey
An agent requests a protected non-Bash tool. The host canonicalizes trusted filesystem state where needed, sends a bounded structured request to the native core, validates the returned decision metadata, and then continues through the existing TypeScript-owned prompt/execution path.

## 7. Preconditions
- e16s02, e16s03, and e16s05 are passing.
- e16s04 has established deterministic production engine selection and fallback diagnostics.

## 8. Inputs
Tool names, normalized/canonicalized tool inputs, scoped permission rules, cwd metadata, and existing audit-safe actor/request summaries.

## 9. Outputs
Validated allow/deny/ask decisions, canonical permission key selection, denial reason class, and audit-ready metadata matching the TypeScript behavior.

## 10. Requirements
- ADDED: Native orchestration shall match TypeScript permission-key mapping for built-in tools, MCP tools, and custom tool families.
- ADDED: Native orchestration shall preserve deny precedence, ask fallback, YOLO exceptions, subagent runtime-approval gating inputs, and scoped policy outcomes.
- ADDED: TypeScript shall remain authoritative for filesystem canonicalization, project trust, prompt queues, audit writes, saved-rule persistence, and tool execution.
- ADDED: Any invalid native orchestration output shall fall back to the current TypeScript path without widening authorization.

## 11. Quality attributes
Security parity, small trusted boundary, deterministic fallback, and auditable migration steps.

## 12. Interfaces and contracts
The native package receives bounded JSON-compatible permission requests and returns a versioned orchestration result. The host validates contract version, operation, nonce, decision shape, and metadata before use.

## 13. State
No native persistent state. Decisions are per request.

## 14. Dependencies
- Native package contract and bundled loader from e16s05.
- Existing permission-boundary, config, scope, and subagent permission tests.

## 15. Failure modes
Policy drift for non-Bash tools, native output accepted without full validation, filesystem trust accidentally delegated to Rust without host canonicalization, or native fallback masking a widened allow.

## 16. Observability
Parity tests shall report the tool family, scoped policy source, decision, reason class, and whether native or TypeScript produced the accepted result.

## 17. Acceptance criteria
### Scenario: Non-Bash decisions match TypeScript
**Given** read, write, edit, subagent, MCP, and custom-tool permission fixtures
**When** the native orchestration operation evaluates them
**Then** decisions and audit metadata match the TypeScript implementation.

### Scenario: Host-owned filesystem and prompt behavior stays unchanged
**Given** a path-sensitive request or an ask decision
**When** native orchestration is active
**Then** TypeScript still owns canonicalization, trust checks, prompt rendering, saved-rule persistence, and execution.

### Scenario: Invalid native orchestration is safe
**Given** a malformed, throwing, or incompatible native orchestration response
**When** the host evaluates a protected request
**Then** it falls back to the TypeScript decision path and never upgrades to allow because of the failed native result.

## 18. Automated verification
- `node --test extensions/tool-permissions/permission-boundary.test.ts extensions/tool-permissions/native-orchestration-parity.test.ts extensions/tool-permissions/native-fallback.test.ts`
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
- `npm run check`

## 19. Implementation steps
1. Add RED parity tests for non-Bash decision orchestration across read/write/edit/subagent/MCP/custom tools.
2. Extend the native contract and Rust core with a validated orchestration operation.
3. Route eligible host decisions through native orchestration while preserving TypeScript-owned side effects and fallback.
4. Run full security regression and package checks.

## 20. Definition of done
More permission decision computation runs through the native Rust core with executable parity evidence, while all side-effecting Pi host responsibilities remain TypeScript-owned and fail safe.
