# Pi Extensions Package Migration

## Reason for existence

This document is the durable specification and resume point for moving portable Pi extensions from machine-local discovery into a private, git-installable Pi package.

## Goal

Publish `favilo/pi-extensions` as a private GitHub repository installable on authenticated computers with:

```bash
pi install git:github.com/favilo/pi-extensions
```

## Decisions

- Repository path: `~/git/agent-skills/pi-extensions`.
- Distribution: private GitHub repository, git only; no npm publication.
- Structure: one Pi package with one folder per extension.
- Tests are colocated with the extension they verify.
- `package.json` explicitly lists each `index.ts`; helper and test files must never be auto-loaded.
- Work-specific `codex-mcp.ts`, `codex-mcp/`, and `mcp.ts` remain in `~/.pi/agent/extensions`.
- `mcp.ts` remains local because it imports `codex-mcp.ts` and reports Codex-specific state.
- Portable extensions are copied before originals are removed. Never remove the originals without explicit user approval.
- This computer installs the local checkout for immediate `/reload` development; other computers install the private GitHub repository.

## Shared extensions

1. `built-in-tool-renderer`
2. `clear-reload`
3. `enable-extra-tools`
4. `exit`
5. `focus-aware-cursor`
6. `jj-status`
7. `local-agent-context`
8. `tool-permissions`

## Out of scope

- Publishing to npm.
- Sharing the work-specific Codex MCP implementation.
- Copying local permission rules, audit logs, credentials, or Pi settings.
- Changing extension behavior except where required for package portability.

## Acceptance criteria

- Every shared extension lives under `extensions/<name>/index.ts`.
- Tests live under the matching extension folder.
- `npm run check` passes.
- `npm audit --omit=dev` reports no production vulnerabilities.
- Pi loads the package with `pi --no-extensions -e . --list-models`.
- `github.com/favilo/pi-extensions` exists as a private repository.
- A second authenticated computer can install the repository through `pi install`.
- Local source copies are removed only after package installation is verified, preventing duplicate extension loading.
- `codex-mcp` and its `mcp` status command continue loading locally.

## Current state

Completed:

- Created the modular package structure.
- Copied and reorganized the eight portable extensions.
- Colocated 19 existing tests.
- Added an explicit Pi package manifest, portable TypeScript configuration, dependency declarations, and README.
- Verified type checking and all 19 tests.
- Verified zero production dependency vulnerabilities.
- Verified Pi can load the package through a temporary local package invocation.
- Initialized a colocated Jujutsu repository.
- Created the private GitHub repository `favilo/pi-extensions`.
- Added the SSH remote with Jujutsu.
- Created the `main` bookmark and pushed the initial package to GitHub.
- Removed the eight original portable extension copies after explicit user approval.
- Installed the local package path globally through Pi.
- Verified a fresh Pi process loads the package without duplicate or startup diagnostics.
- Verified the 24 retained Codex MCP tests still pass.

Pending:

1. Reload the active Pi session.
2. Manually confirm `/mcp`, `/permissions`, and `/clear` are available.

## Known issue

A development-only transitive dependency inside `@earendil-works/pi-coding-agent` currently triggers an npm audit advisory for `brace-expansion`. Production dependencies are clean, and git package installation omits development dependencies. Do not weaken runtime dependency checks to hide this upstream development advisory.

## Verification

Run from the repository root:

```bash
npm run check
npm audit --omit=dev
pi --no-extensions -e . --list-models
jj status
```
