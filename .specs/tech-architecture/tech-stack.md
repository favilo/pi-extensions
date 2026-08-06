# Technology Stack

## Runtime

- TypeScript, native ESM, and Node.js test execution.
- Pi coding agent extensions loaded from the `pi.extensions` entries in `package.json`.
- Jujutsu is the repository's version-control system.

## Dependencies

- `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` provide the Pi SDK and terminal UI peer contracts.
- `smol-toml` parses permission configuration.
- `@decimalturn/toml-patch` preserves formatting while updating TOML.
- `ignore` provides ignore-pattern matching.
- `typebox` provides runtime schemas for bridged tool requests.

## Architecture

- Each extension owns implementation and tests under `extensions/<name>/`.
- `tool-permissions` is the single authorization boundary and audit owner.
- `subagent` creates child `AgentSession` instances and forwards child tool requests through `tool-permissions`; it does not implement a second policy evaluator.
- `tool-registry` publishes shared tool definitions used by the subagent bridge.
- Tests use Node's built-in test runner and deterministic fakes; no network or credentials are required.

## Verification commands

```text
npm run typecheck
npm test
npm run check
```

No separate lint command is configured. Project-level policy checks are available through `npm run check:plans` and `npm run check:portability`.
