# BUG-2026-08-21T122441: MCP provider child processes never disposed, `pi -p` hangs on exit

## Problem

- **Actual**: `pi -p "..."` (non-interactive mode) with extensions enabled prints the
  response, then hangs indefinitely instead of exiting (observed 45s+; killed by timeout).
- **Expected**: process exits cleanly after printing, as it does with `--no-extensions` (~2s).
- **Reproduce**:
  ```
  timeout 20 pi --no-extensions -e extensions/mcp \
    -e ~/.pi/agent/extensions/bevy-debugger-mcp/index.ts \
    --model casper.ditto/kimi-k2.6 -p "Reply with exactly: ok"
  ```
  Prints `ok`, then hangs until the timeout kills it (exit 124).
- **Security impact**: NONE — liveness/UX issue only; no exploit path identified.

## Root Cause Analysis

Verified via 4-phase RCA (reproduce → isolate → hypothesize → verify):

1. **Reproduce**: full extension set hangs (exit 124 at 40s); `--no-extensions` exits in ~2s.
2. **Isolate**: every extension in `package.json`'s `pi.extensions` list passes individually
   *and* collectively (all 11 together exit in 4s). Inspecting the hanging process's children
   revealed a spawned `bevy_brp_mcp` MCP server process. The bevy provider lives in
   `examples/bevy-debugger-mcp` (symlinked into the user extensions dir, so it loads
   outside the package manifest — which is why the manifest-only bisect missed it).
   Minimal repro pair: `mcp` + `bevy-debugger-mcp` → hang.
3. **Root cause** (two cooperating gaps):
   - The MCP provider registry contract (`McpToolProvider`) has **no disposal hook**.
     On `session_shutdown` the registry unregisters tool names but never tells providers
     to release resources. The bevy provider defines `dispose()` (which closes the
     `StdioMcpClient` and kills the child), but nothing in the registry ever calls it.
   - The bevy extension's default export calls `registerBevyDebuggerProvider(pi)` and
     **discards the returned stop function** — the only code path that invokes
     `provider.dispose()`.
4. **Verify**: with both extensions loaded, the spawned `bevy_brp_mcp` child keeps stdio
   pipes open, which keeps the Node event loop alive after the run completes → hang.
   Corroborating evidence: multiple orphaned `bevy_brp_mcp` processes 8–9 days old on the
   machine, so the leak also affects interactive sessions (they exit, but leak children).

**Contributing factor**: any stdio-based MCP provider registered through the registry has
the same leak; bevy is just the one currently installed.

**Risk level**: Low — fix adds an optional lifecycle hook and wires one event handler.

## TDD Fix Plan

1. **RED**: Write a test that a provider defining `dispose()` has it called when the
   registry unregisters that provider (`unregister`).
   **GREEN**: Add optional `dispose(): void` to the `McpToolProvider` contract; call
   `provider.dispose?.()` in `unregister` (covers `unregisterAll` too).
   **verify**: `node --test extensions/mcp/registry.test.ts`

2. **RED**: Write a test that on `session_shutdown` the mcp extension disposes all
   registered providers (observable: a registered provider's `dispose` spy is called).
   **GREEN**: No change expected if cycle 1 routes through `unregisterAll` → `unregister`;
   otherwise wire it in the shutdown handler.
   **verify**: `node --test extensions/mcp/lifecycle.test.ts extensions/mcp/index.test.ts`

3. **RED**: Write a test that the bevy example extension, when loaded with a mock pi API,
   calls the provider's `dispose` on `session_shutdown` (defense in depth: the extension
   must not drop its own stop handle).
   **GREEN**: In the bevy example's default export, keep the stop function returned by
   `registerBevyDebuggerProvider` and register it via `pi.on("session_shutdown", stop)`.
   **verify**: `node --test examples/bevy-debugger-mcp/index.test.ts`

4. **RED** (acceptance): the reproduction command above exits 0 in under 10s.
   **GREEN**: passes after cycles 1–3.
   **verify**: `timeout 10 pi --no-extensions -e extensions/mcp -e ~/.pi/agent/extensions/bevy-debugger-mcp/index.ts --model casper.ditto/kimi-k2.6 -p "Reply with exactly: ok"`

**REFACTOR**: Consider documenting the `dispose` contract in the mcp extension README so
future providers (e.g. codex-mcp-style stdio clients) implement it.

## Acceptance Criteria

- [x] Registry calls `dispose()` (when defined) on provider unregister/shutdown
- [x] Bevy example extension invokes its stop handle on session shutdown
- [x] `pi -p` with mcp + bevy-debugger-mcp exits cleanly (<10s) — verified: 4s (was 20s+ hang)
- [x] All new tests pass
- [x] Existing tests still pass (`npm run test`) — 178/178
- [x] Full extension set `pi -p` exits cleanly — verified: 5s (was 40s+ hang)

## Resolution

**Fixed:** 2026-08-21
**Root cause confirmed:** The MCP provider registry contract had no disposal hook, so `session_shutdown` unregistered tools but never released provider resources; the bevy-debugger-mcp provider's spawned `bevy_brp_mcp` stdio child kept the Node event loop alive, hanging `pi -p` after it printed.
**Fix applied:** Added optional `dispose()` to the `McpToolProvider` contract, called from `McpProviderRegistry.unregister` (covering `unregisterAll`/`session_shutdown`); the bevy example's default export now keeps its registration stop handle and wires it to `session_shutdown`; added a package.json `exports` wildcard so the example's documented `pi-extensions/*` self-imports resolve at runtime in-repo.
**Hardening added:** Invariant tests locking the dispose contract (unregister exactly-once, unregisterAll, session_shutdown at both registry and extension level); README documents the dispose contract with an explicit `pi -p` hang warning; generalize-fix sweep of the defect class (resource acquisition without shutdown disposal) recorded in `.specs/verifications/generalize-sweep-BUG-2026-08-21T122441.json` — 3 matches, 1 fixed (this bug), 2 verified not affected.
**Evidence:** `npm test` 178/178 pass; `npx tsc --noEmit` clean; `npm run check:ci` green; behavioral proof on rebased branch — minimal repro (`mcp` + `bevy-debugger-mcp`) exits 0 in ~3s and full extension set `pi -p` exits 0 in ~5s (both previously hung past timeout).
**Commits:** `fix(mcp): dispose providers on unregister` (mrqoszrl), `fix(bevy-debugger-mcp): dispose provider on session shutdown` (nrwlwsuu) — PR favilo/pi-extensions#9
