# e06s08 — Export compact or complete subagent context

## 1. Identity
- **Story:** e06s08
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 5
- **Risk:** P0
- **Delta:** ADDED
- **WSJF:** 5.0 — `(business value 7 + time criticality 5 + risk reduction 8) / job size 4`

## 2. User need
Users need compact child results in model context and an explicit way to persist the complete exposed child context for external analysis without flooding the parent model.

## 3. Goal
Make `subagent_result({ id })` return only status plus a bounded final assistant message, while `subagent_result({ id, full_context: path, overwrite? })` writes a versioned, exporter-untruncated JSON snapshot and returns compact export metadata.

## 4. Non-goals
- Automatically injecting normalized events or exported content into parent model context.
- Exporting private provider reasoning or hidden chain-of-thought.
- Persisting an additional transcript before an explicit export request.
- Recovering bytes that a source tool had already truncated before Pi stored its result.
- Resuming child execution from an export.

## 5. Requirements

#### ADDED: Compact default result
- Keep the public API name `subagent_result` singular.
- For queued, running, or waiting-for-permission children, return status metadata only and do not fabricate output.
- For completed, failed, or cancelled children, return status metadata plus only the final exposed assistant text when one exists.
- Cap the model-facing final assistant text at 8 KiB of valid UTF-8 without splitting a code point.
- Report original and returned UTF-8 byte counts plus explicit `outputTruncated` metadata.
- Exclude normalized events, tool inputs, tool results, and export content from model-facing default results and result details.

#### ADDED: Explicit full-context export
- Accept `full_context: <file_path>` for a child in any lifecycle state.
- Capture one internally consistent snapshot and report that captured status in both the file and compact tool result.
- For non-terminal children, mark the snapshot incomplete and include all finalized exposed context available at the capture boundary; do not claim to include an in-flight partial event.
- Source export data from Pi's existing child `SessionManager`, which remains the sole durable child-message store, and normalize finalized exposed assistant text, tool calls, tool results, and terminal output into the project-owned export schema.
- Exclude thinking/reasoning blocks and extension-internal authority data.
- The exporter must impose no event-count, payload-byte, output-byte, or total-file truncation. It must preserve source values exactly as Pi stored them, including any source tool's own truncation fields.
- Stream serialization to a destination-local temporary file so unbounded export size does not require one equally large in-memory JSON string.
- If serialization or publication fails, return an error, remove the temporary file, and leave no partial destination.
- Return only compact metadata to the model: child ID, captured status, terminal/snapshot-complete state, resolved path, bytes written, overwrite outcome, schema version, and export success or failure. Never return exported content.

#### ADDED: Safe destination and overwrite semantics
- Resolve relative paths against the parent session cwd; accept absolute paths, including `/tmp` and other user-approved destinations.
- Normalize a single leading `@` consistently with Pi file tools.
- Require the destination parent directory to exist; do not create parent directories implicitly.
- Canonicalize the existing destination or its existing parent before policy evaluation and execution. Fail closed on canonicalization errors.
- Route export requests through the shared write-class permission policy. Configured deny wins; a configured allow may execute without prompting; otherwise the normal prompt must show the resolved destination and whether replacement was requested.
- Use the same canonical target identity for permission evaluation, mutation queueing, and publication.
- Default `overwrite` to `false`; fail if the destination exists.
- When `overwrite: true`, atomically replace only an existing regular file. Reject symlinks, directories, devices, sockets, and other non-regular destinations.
- Publish atomically within the destination directory. New exports must not expose partial content; replacement must leave either the previous complete file or the new complete file.
- Create temporary and final files with mode `0600` on POSIX systems. On Windows, request no broader permissions and rely on the current user's inherited ACL.
- Avoid logging destination content, normalized events, final output, or raw permission input. Debug and audit records may contain only safe identity/status fields and a path identity hash where appropriate.

#### ADDED: Versioned JSON schema
- Write UTF-8 JSON with top-level `schemaVersion: 1`.
- Include generated child ID, child cwd, captured lifecycle status, terminal flag, snapshot completeness, capture timestamp, normalized finalized events, optional final assistant output, and source truncation metadata already present in stored tool results.
- Keep ordering deterministic and preserve normalized event sequence.

## 6. Failure modes
Unknown child ID, export while active, destination denial, missing parent directory, existing destination without overwrite, symlink or non-regular destination, destination race, serialization failure, cancellation, disk exhaustion, atomic publication failure, and shutdown during export.

## 7. Preconditions
- E06s05 provides generated child IDs, lifecycle state, normalized event semantics, and parent-owned cleanup.
- Pi's child `SessionManager` remains available to the retained runtime until parent-session shutdown.
- Tool permissions can classify the export variant as a write-class mutation using its canonical destination.

## 8. Inputs
Generated child ID, optional `full_context` path, optional `overwrite` boolean, parent cwd, current child lifecycle state, child session entries, and invocation cancellation.

## 9. Outputs
Compact status/final-message JSON or compact export metadata plus an explicitly approved versioned JSON file.

## 10. Quality attributes
Small model-context footprint, complete explicit exports, deterministic snapshots, atomic publication, restrictive permissions, cancellation safety, and no reasoning leakage.

## 11. Interfaces and contracts
- `subagent_result({ id })` is read-only and returns compact status plus at most 8 KiB of final assistant text.
- `subagent_result({ id, full_context, overwrite? })` is a file mutation and returns compact metadata only.
- The controller keeps model-facing result projection separate from an internal export snapshot interface. **Reason for Depth:** retrieval bounds and filesystem persistence have different disclosure, lifecycle, and authorization requirements.
- Export normalization consumes finalized child session entries rather than the bounded live-display buffer. **Reason for Depth:** the live buffer must remain memory-bounded while an explicitly approved export must not add truncation.
- Filesystem publication is isolated behind one canonical, permission-aware exporter. **Reason for Depth:** path identity, overwrite, file mode, cancellation, and atomicity must not be reimplemented in the tool registration layer.

## 12. State
No export state survives beyond the published file and compact tool result. Running-child exports are point-in-time snapshots. Parent shutdown cancels in-progress export work and removes unpublished temporary files.

## 13. Dependencies
- `[OK] node:fs/promises`, `node:path`, and `node:stream` — existing runtime APIs; no package added.
- `[OK] @earendil-works/pi-coding-agent` — child `SessionManager`, file mutation queue, and extension tool context.
- Existing `extensions/subagent/` and `extensions/tool-permissions/` boundaries.

## 14. Failure modes
A path changes after approval, overwrite replaces an unsafe target, exporter reads hidden reasoning, active export claims completion, output enters tool details, or an aborted write leaves a partial file.

## 15. Observability
Return safe status, schema version, path, byte count, overwrite outcome, snapshot completeness, and failure category. Never log or return exported content.

## 16. Impact
Changes the shared `subagent_result` schema and result contract, retained runtime/session access, result rendering, write-policy classification, and e06 transcript persistence threat model. E06s05 result tests and e06s06 normalized-event consumers must remain compatible.

## 17. Acceptance criteria
### Scenario: Active child status remains compact
**Given** a child is queued, running, or waiting for permission
**When** the parent calls `subagent_result({ id })`
**Then** the result reports current status without output, normalized events, or fabricated completion.

### Scenario: Terminal result returns only bounded final text
**Given** a child is terminal and has a final exposed assistant message larger than 8 KiB
**When** the parent calls `subagent_result({ id })`
**Then** the result contains only status metadata and a valid UTF-8 8 KiB preview with original/returned byte counts and `outputTruncated: true`.

### Scenario: Export any lifecycle state
**Given** a known child in any lifecycle state and an approved destination
**When** the parent calls `subagent_result({ id, full_context: path })`
**Then** a versioned point-in-time JSON snapshot is atomically written and the tool returns only compact metadata containing the captured status and snapshot completeness.

### Scenario: Export is not truncated by the exporter
**Given** the child session contains exposed finalized context larger than the live event-buffer and model-result limits
**When** full context is exported
**Then** the file contains every finalized exposed session event and final output available at the capture boundary without exporter-added truncation, while private reasoning remains absent.

### Scenario: Existing destination requires explicit overwrite
**Given** the destination is an existing regular file
**When** export omits `overwrite` or sets it to `false`
**Then** publication fails without changing the file; when `overwrite: true` is approved, the complete old file is atomically replaced by the complete new file.

### Scenario: Unsafe destination fails closed
**Given** the destination or its parent cannot be canonicalized, or the destination is a symlink or non-regular file
**When** export is requested
**Then** permission evaluation or publication rejects it without writing exported content or leaving a temporary file.

### Scenario: Export permission exposes destination
**Given** no configured write allow or deny matches
**When** a full-context export is requested
**Then** the shared permission queue shows the canonical destination and overwrite intent, and only an explicit allow permits publication.

## 18. Automated verification
- `node --test extensions/subagent/result-export.test.ts extensions/subagent/background-session.test.ts`
- `node --test extensions/subagent/index.test.ts extensions/subagent/result-renderer.test.ts`
- `node --test extensions/tool-permissions/index.test.ts extensions/tool-permissions/prompt-queue.test.ts`
- `npm run check`

## 19. Implementation steps
For every behavior, create a behavioral RED Jujutsu change before a separate GREEN implementation change. Missing exports, imports, modules, or functions are invalid RED evidence.

1. Split compact model-facing projection from complete internal session snapshots; expose status-only active results and 8 KiB terminal final text with byte/truncation metadata → verify: `node --test extensions/subagent/background-session.test.ts extensions/subagent/index.test.ts`
2. Normalize all finalized exposed child `SessionManager` entries into deterministic schema-v1 exports while excluding reasoning and avoiding exporter-added truncation → verify: `node --test extensions/subagent/result-export.test.ts`
3. Resolve canonical destinations, classify exports under shared write permission, and expose destination plus overwrite intent in the FIFO prompt → verify: `node --test extensions/tool-permissions/index.test.ts extensions/tool-permissions/prompt-queue.test.ts`
4. Stream destination-local temporary files, publish atomically with restrictive mode, support explicit regular-file overwrite, and clean up every failure/cancellation path → verify: `node --test extensions/subagent/result-export.test.ts`
5. Keep collapsed/expanded tool rendering compact, document the API, update the e06 threat model, and run package regressions → verify: `node --test extensions/subagent/index.test.ts extensions/subagent/result-renderer.test.ts && npm run check`

## 20. Definition of done
Default retrieval consumes at most 8 KiB of child output in model context, while an explicitly approved export can persist a complete, versioned, exporter-untruncated snapshot for any child lifecycle state without unsafe overwrite, partial publication, or reasoning leakage.
