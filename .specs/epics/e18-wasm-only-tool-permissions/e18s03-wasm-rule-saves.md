# e18s03 — Move rule saves and permissions.toml patches into WASM

## 1. Identity
- **Story:** e18s03
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P0
- **Delta:** MODIFIED

## 2. User need
Allow-and-save still patches `permissions.toml` in TypeScript. A failed save must not look successful, and the saved rule must be exactly the rule the user approved.

## 3. Goal
WASM applies the existing user and project save actions, patching the same `permissions.toml` files with the same rule text.

## 4. Non-goals
- New save shortcuts or a new rule syntax.
- Moving prompts, audit writes, path trust, or tool execution.
- Removing the TypeScript load-failure fallback. That is e18s06.
- Deleting `extensions/tool-permissions/index.ts`.

## 5. Users
People who save an allow rule to user policy or to the current directory's project policy.

## 6. User journey
The user accepts a prompt and chooses the existing user or project save action. WASM patches the selected `permissions.toml`. The prompt reports success only after the patch is durable. A failed patch does not allow the call as a saved rule.

## 7. Preconditions
- Existing user and project save commands and their tests describe the patch.
- e18s00 has recorded adopt or reject for `pi-oxidized-ext`. This story uses that host.
- e18s01 is the planned owner of path trust. This story consumes the current trust result and does not widen which file may be patched.

## 8. Inputs
Approved rule text, save scope, destination path, and the current file contents.

## 9. Outputs
An updated `permissions.toml` that contains the approved rule once, or a visible failure with the previous file contents preserved.

## 10. Requirements
#### MODIFIED: Saved-rule owner
**Before:** e16s03 and e16s06 require TypeScript to own saved-rule persistence.
**After:** On a successful WASM call, Rust patches the selected `permissions.toml` and TypeScript does not apply a second patch.

#### ADDED: Failed save does not allow
A failed or partial patch restores the previous file contents, reports failure, and does not allow the tool call as though the rule was saved.

## 11. Quality attributes
Durable write, no widened rule, and no duplicate patch.

## 12. Interfaces and contracts
Rust receives the approved rule and destination. It writes TOML that the current loader can read. The host rejects a destination outside the existing user-policy or trusted project-policy path.

## 13. State
User policy stays at the current user `permissions.toml`. Project policy stays at the current directory `.pi/permissions.toml`. No new file location is introduced.

## 14. Dependencies
- Existing save-scope tests and TOML loader.
- `.specs/security/epics/e18/THREAT_MODEL.md` threats 2 and 4.

## 15. Failure modes
A crash leaves a truncated TOML file. The saved rule is broader than the approval. TypeScript and WASM both append the rule. Success is reported before the file is durable.

## 16. Observability
Tests report the destination path, rule text, file byte equality after failure, and whether the tool call was allowed.

## 17. Acceptance criteria
### Scenario: User and project saves match today
**Given** an approved rule and the existing user and project save actions
**When** WASM patches the selected file
**Then** the file contains that rule once and the current loader reads it back.

### Scenario: Failed save preserves the file and denies
**Given** a destination that cannot be written
**When** the user chooses a save action
**Then** the previous contents remain, the failure is reported, and the tool call is not allowed as a saved rule.

## 18. Automated verification
- `node --test extensions/tool-permissions/native-rule-save.test.ts`
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
- `npm run build:native && npm run check`

## 19. Implementation steps
1. Add failing tests for user save, project save, duplicate protection, and failed-save denial. → verify: `node --test extensions/tool-permissions/native-rule-save.test.ts`
2. Add the Rust TOML patch operation for an already authorized destination and rule. → verify: `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
3. Route success-path saves through WASM. → verify: `node --test extensions/tool-permissions/native-rule-save.test.ts`
4. Run the native build and full checks. No new security findings in affected paths. → verify: `npm run build:native && npm run check`

## 20. Definition of done
Successful rule saves are patched once by WASM, round-trip through the current loader, and fail closed when the patch does not become durable.
