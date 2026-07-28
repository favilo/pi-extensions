# e02s01 — Protect previously untested extensions with unit contracts

## 1. Identity
- **Story:** e02s01
- **Type:** test
- **Maturity:** 3 — Countable
- **BCPs:** 4
- **Risk:** P1

## 2. User need
A Pi extension maintainer needs fast regression feedback before changing commands, lifecycle handling, tool activation, or local context loading.

## 3. Goal
Add deterministic public-behavior unit tests for clear-reload, enable-extra-tools, exit, and local-agent-context.

## 4. Non-goals
- Launching a real Pi process.
- Changing production behavior.
- Re-testing extensions with existing coverage.

## 5. Users
Maintainers of this Pi extension package.

## 6. User journey
A maintainer changes an extension, runs `npm test`, and receives a focused failure when a documented command or lifecycle contract regresses.

## 7. Preconditions
The extension package and Node test runner are installed.

## 8. Inputs
Fake Pi APIs, command contexts, lifecycle events, and isolated temporary filesystem fixtures.

## 9. Outputs
Four focused test files discovered by the existing package test command.

## 10. Requirements
### ADDED: Clear and reload command coverage
Tests shall prove idle waiting, parent-session forwarding, replacement-context reload, UI notification, and cancellation warning behavior.

### ADDED: Extra tool coverage
Tests shall prove grep/find/ls activation is idempotent and `/tools-debug` reports active and configured names.

### ADDED: Exit alias coverage
Tests shall prove `/exit` delegates to graceful context shutdown.

### ADDED: Local context coverage
Tests shall prove parent-first ordering, nearest Git boundary, filename ordering, trimming, empty-file omission, and no-op behavior.

## 11. Quality attributes
Fast, independent, repeatable, self-validating, timely, offline, and deterministic.

## 12. Interfaces and contracts

**Purpose:** Each extension adapts Pi's public extension API into one focused behavior: session replacement, active-tool configuration, graceful shutdown, or system-prompt augmentation.

**Callers:** Pi's extension loader, lifecycle dispatcher, command dispatcher, and agent-start pipeline.

**Contracts:** Registered command names/descriptions, event names, context method ordering, active-tool preservation, Git-boundary traversal, prompt ordering, and no-op behavior.

**Reason for Depth:** No new abstraction is introduced; tests use local fake boundaries because launching Pi would turn unit contracts into slower process integration tests.

## 13. State
Tests must not share mutable state. Filesystem fixtures are created per test and removed in cleanup.

## 14. Dependencies
- `[OK] node:test` — built-in test runner already used by the repository.
- `[OK] node:assert/strict` — built-in assertions already used by the repository.
- No new package.

## 15. Failure modes
Tests become order-dependent, leak temporary files, overfit private helpers, or omit cancellation/no-op branches.

## 16. Observability
Focused test names identify the broken extension contract and package-wide output confirms discovery.

## 17. Acceptance criteria
### Scenario: Clear replaces and reloads a session
**Given** a command context with a current session
**When** `/clear` runs
**Then** it waits for idle, forwards the parent session, notifies through the replacement context, and reloads that context.

### Scenario: Clear is cancelled
**Given** another extension cancels session replacement
**When** `/clear` completes
**Then** the current UI receives a warning and no replacement reload occurs.

### Scenario: Extra tools activate repeatedly
**Given** existing active tools
**When** session start fires more than once
**Then** grep, find, and ls are present exactly once and existing tools remain.

### Scenario: Debug and exit commands delegate
**Given** registered command handlers
**When** `/tools-debug` or `/exit` runs
**Then** debug output lists tool names and exit requests graceful shutdown.

### Scenario: Local context augments a prompt
**Given** nested local context files beneath a nearest Git boundary
**When** agent start fires
**Then** non-empty files are appended broadest-first with local overrides last and files above the boundary are excluded.

### Scenario: No local context exists
**Given** no non-empty local context file
**When** agent start fires
**Then** the handler returns no system-prompt replacement.

## 18. Automated verification
- `node --test extensions/clear-reload/index.test.ts`
- `node --test extensions/enable-extra-tools/index.test.ts`
- `node --test extensions/exit/index.test.ts`
- `node --test extensions/local-agent-context/index.test.ts`
- `npm run check`

## 19. Implementation steps
1. Add clear-reload command characterization tests → verify: `node --test extensions/clear-reload/index.test.ts`
2. Add extra-tool activation and debug command characterization tests → verify: `node --test extensions/enable-extra-tools/index.test.ts`
3. Add graceful exit alias characterization test → verify: `node --test extensions/exit/index.test.ts`
4. Add isolated filesystem context-loading characterization tests → verify: `node --test extensions/local-agent-context/index.test.ts`
5. Run package-wide type and regression checks → verify: `npm run check`

## 20. Definition of done
All four focused test files pass independently, package-wide discovery executes them, temporary fixtures are cleaned, and production extension files remain unchanged unless a test exposes a separately documented defect.
