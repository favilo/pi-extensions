# e18s02 — Move audit log writes into WASM

## 1. Identity
- **Story:** e18s02
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 3
- **Risk:** P0
- **Delta:** MODIFIED

## 2. User need
Security review depends on one audit record per permission decision. That write still lives in TypeScript, so the WASM runtime is not yet the owner of the evidence.

## 3. Goal
WASM writes the same audit records the TypeScript logger writes today, once per decision, without a second TypeScript write on the success path.

## 4. Non-goals
- Changing audit fields, retention, or file location.
- Moving prompts, rule saves, path trust, or tool execution.
- Removing the TypeScript load-failure fallback. That is e18s06.
- Deleting `extensions/tool-permissions/index.ts`.

## 5. Users
Maintainers who review permission decisions from the audit log.

## 6. User journey
A tool request is allowed, denied, or asked. WASM appends one audit record with the same decision, tool, path or command, and reason fields the current logger writes.

## 7. Preconditions
- e16 native registration and orchestration are passing.
- e18s00 has recorded adopt or reject for `pi-oxidized-ext`. This story uses that host.
- The current audit logger and its fixtures describe the record shape.

## 8. Inputs
Decision class, tool name, actor, working directory, path or command, reason, and the existing audit destination.

## 9. Outputs
One appended audit record per decision. A failed write is reported and does not become an allow.

## 10. Requirements
#### MODIFIED: Audit write owner
**Before:** e16s03 and e16s06 require TypeScript to own audit file writes.
**After:** On a successful WASM call, Rust writes one equivalent audit record and TypeScript does not write a second copy.

#### ADDED: Audit failure does not allow
A failed audit write denies the request or surfaces the existing failure behavior. It never upgrades the decision to allow.

## 11. Quality attributes
One record, field parity, and no policy secrets in the log.

## 12. Interfaces and contracts
Rust builds the audit record and writes it through the existing audit destination. The host validates the record shape. The module does not invent a second log format.

## 13. State
The audit file remains the current append-only log. WASM must not create a parallel log on the success path.

## 14. Dependencies
- Current audit logger fixtures.
- `.specs/security/epics/e18/THREAT_MODEL.md` threats 1 and 2.

## 15. Failure modes
Duplicate records from TypeScript and WASM. Dropped denies. Secrets from `permissions.toml` copied into the log.

## 16. Observability
Tests print the decision, tool, and record count for the request. They fail when the record count is not one.

## 17. Acceptance criteria
### Scenario: One equivalent audit record
**Given** allow, deny, and ask fixtures covered by the current logger
**When** the decision completes through WASM
**Then** the audit file gains one record with the same decision fields and no second TypeScript write.

### Scenario: Failed audit write does not allow
**Given** an audit destination that cannot be written
**When** WASM handles the decision
**Then** the tool call is not allowed because the audit write failed.

## 18. Automated verification
- `node --test extensions/tool-permissions/native-audit-write.test.ts`
- `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
- `npm run build:native && npm run check`

## 19. Implementation steps
1. Add failing tests for one-record parity and failed-write denial. → verify: `node --test extensions/tool-permissions/native-audit-write.test.ts`
2. Add the Rust audit-write operation using the current record fields. → verify: `cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
3. Route success-path audit writes through WASM and suppress the duplicate TypeScript write. → verify: `node --test extensions/tool-permissions/native-audit-write.test.ts`
4. Run the native build and full checks. No new security findings in affected paths. → verify: `npm run build:native && npm run check`

## 20. Definition of done
Success-path audit records are written once by WASM and match the current field contract. Load-failure fallback remains until e18s06.
