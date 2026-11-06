# e18s01 — Move path canonicalization, project trust, and .aiignore into WASM

## 1. Identity
- **Story:** e18s01
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P0
- **Delta:** MODIFIED

## 2. User need
Path-sensitive permission checks still depend on a second TypeScript implementation. One wrong canonical path, trust root, or `.aiignore` match can allow a tool call the current extension would deny.

## 3. Goal
On the success path, the WASM runtime canonicalizes permission paths, applies project trust, and matches `.aiignore` with the same results as today's TypeScript host.

## 4. Non-goals
- Editing e16 stories.
- Deleting `extensions/tool-permissions/index.ts`.
- Moving prompts, audit writes, rule saves, or tool execution.
- Removing the TypeScript load-failure fallback. That is e18s06.
- Changing trust rules, repository bounds, or `.aiignore` semantics.

## 5. Users
People who rely on project trust and `.aiignore` to bound read, write, and edit permissions.

## 6. User journey
An agent requests a path-sensitive tool. WASM canonicalizes the path, checks the persisted trust root and `.aiignore`, and returns the same allow, deny, or ask class the TypeScript host returns today. The existing prompt and execution path still runs after that result.

## 7. Preconditions
- e16s01 through e16s07 are passing.
- e18s00 has recorded adopt or reject for `pi-oxidized-ext`. This story uses that host.
- The NAPI package loads `wasm32-wasip1-threads` with flavor `wasm32-wasi`.
- Current path, trust, and `.aiignore` tests describe the oracle.

## 8. Inputs
Tool name, requested path, working directory, persisted trust decision, `.aiignore` contents, and the current permission rules.

## 9. Outputs
A canonical path, canonical working directory, trust eligibility, `.aiignore` match, and the same decision class the TypeScript path produces for those fixtures.

## 10. Requirements
#### MODIFIED: Filesystem trust owner
**Before:** e16s06 requires TypeScript to own filesystem canonicalization, project trust, and `.aiignore` checks.
**After:** On a successful WASM call, Rust owns those checks and returns the same canonical path, trust eligibility, and `.aiignore` decision.

#### ADDED: Invalid path results fail closed
A missing path, unreadable trust record, or invalid WASM path result denies the request and does not become an allow.

## 11. Quality attributes
Parity with the current host, fail closed, and one path result per request.

## 12. Interfaces and contracts
The native package accepts a versioned path-trust request and returns a versioned result. The host validates the contract version and decision shape before use. Rust may use WASI preopens or a narrow host path callback. It does not spawn a shell.

## 13. State
No new persistent state. Trust and `.aiignore` files remain where they are today.

## 14. Dependencies
- e16 native package, loader, and permission-boundary fixtures.
- `.specs/security/epics/e18/THREAT_MODEL.md` threats 1 and 3.

## 15. Failure modes
A symlink resolves outside the trusted root and is allowed. `.aiignore` matches in TypeScript but not in WASM. An invalid WASM result is treated as allow.

## 16. Observability
Tests report the tool, requested path, canonical path, trust root, `.aiignore` match, decision, and whether WASM produced the accepted result.

## 17. Acceptance criteria
### Scenario: Canonical paths match the current host
**Given** path fixtures for read, write, and edit, including missing leaves and symlink parents
**When** WASM evaluates the path-trust operation
**Then** the canonical path and working directory match the current TypeScript result.

### Scenario: Trust and .aiignore match the current host
**Given** a trusted parent, a nearer denial, and a path matched by `.aiignore`
**When** WASM evaluates the request
**Then** project policy is honored only inside the trusted root, and the ignored path is denied.

### Scenario: Invalid WASM path output denies
**Given** a malformed or failed WASM path-trust result
**When** the extension evaluates a path-sensitive request
**Then** the request is denied and is not recorded as an allow.

## 18. Automated verification
- `node --test extensions/tool-permissions/native-path-trust.test.ts extensions/tool-permissions/permission-boundary.test.ts`
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
- `npm run build:native && npm run check`

## 19. Implementation steps
1. Add failing parity tests for canonical paths, trust roots, `.aiignore` denies, and invalid WASM output. → verify: `node --test extensions/tool-permissions/native-path-trust.test.ts extensions/tool-permissions/permission-boundary.test.ts`
2. Add the versioned native path-trust operation and Rust implementation. → verify: `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
3. Route successful path checks through WASM and deny invalid native results. → verify: `node --test extensions/tool-permissions/native-path-trust.test.ts extensions/tool-permissions/permission-boundary.test.ts`
4. Run the native build and full checks. No new security findings in affected paths. → verify: `npm run build:native && npm run check`

## 20. Definition of done
Successful path, trust, and `.aiignore` decisions come from WASM, match the current fixtures, and fail closed on invalid native output. Prompts, saves, audit writes, execution, and the load-failure fallback stay where they are.
