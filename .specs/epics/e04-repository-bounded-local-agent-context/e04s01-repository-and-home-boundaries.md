# e04s01 — Bound local context discovery by repository and home

## 1. Identity
- **Story:** e04s01
- **Type:** bug fix
- **Maturity:** 3 — Countable
- **BCPs:** 4
- **Risk:** P0
- **Delta:** MODIFIED

## 2. User need
A Pi user needs directory-local agent guidance to stay within the active repository or personal workspace so unrelated ancestor files cannot silently alter agent behavior.

## 3. Goal
Resolve the nearest Git or Jujutsu repository root, bound local-context traversal to that root, and apply an explicit HOME ceiling when no repository is available.

## 4. Non-goals
- Changing Pi's native `AGENTS.md` or `CLAUDE.md` loading.
- Loading files directly from `$HOME`.
- Adding `AGENTS.local.md` or `AGENTS.override.md` under `~/.pi/agent`.
- Loading `.agents/AGENTS.md` as Pi context.
- Changing supported local-context filenames or their ordering.
- Sharing implementation with e03 tool-permission discovery before both contracts are proven.

## 5. Users
Pi users running this extension in pure Jujutsu, Git-only, colocated, nested-repository, and non-repository working directories.

## 6. User journey
Pi starts an agent turn, the extension resolves eligible context directories from the current working directory, appends only files inside the nearest safe boundary, and leaves the prompt unchanged when no eligible non-empty file exists.

## 7. Preconditions
- The extension is loaded by Pi.
- `before_agent_start` supplies the current working directory and system prompt.
- Git or Jujutsu may be installed, absent, slow, or unable to identify a repository.

## 8. Inputs
Current working directory, HOME directory, Jujutsu root-probe result, Git root-probe result, local context files, and Pi's existing system prompt.

## 9. Outputs
An unchanged system prompt or one augmented with eligible non-empty local context in deterministic broad-to-near order.

## 10. Requirements
### MODIFIED: Repository boundary discovery
**Before:** Traversal stops only when filesystem inspection finds a `.git` directory.

**After:** The extension probes `jj root --ignore-working-copy` and `git rev-parse --show-toplevel`, accepts only roots that contain cwd, and uses the deepest returned root as the inclusive repository boundary. Each probe has a timeout no greater than 1,000 ms.

### ADDED: Nested repository precedence
When Git and Jujutsu return different valid ancestor roots, the root nearest cwd wins regardless of VCS type. This covers one repository nested inside another repository managed by a different VCS.

### ADDED: HOME fallback inside HOME
When neither probe identifies a repository and cwd is below HOME, traversal may inspect cwd and its ancestors but stops before HOME. Files directly in HOME are never loaded by this extension.

### ADDED: Cwd-only fallback outside HOME
When cwd is not contained by HOME, only cwd is eligible. The extension does not inspect any ancestor.

### ADDED: Fail-closed probe behavior
A timed-out, unavailable, or otherwise operationally indeterminate root probe cannot broaden discovery. If no valid root is available under such uncertainty, only cwd is eligible.

### RETAINED: Context composition
Eligible directories remain broadest-first. Within each directory, `AGENTS.local.md` precedes `AGENTS.override.md`. Missing and blank files remain omitted, and loaded content remains appended after Pi's existing system prompt.

### RETAINED: Native global context
Pi remains responsible for global `~/.pi/agent/AGENTS.md`. This extension neither reloads it nor adds global local/override variants.

## 11. Quality attributes
Deterministic discovery, bounded subprocess latency, fail-closed ancestry, platform-safe path containment, no new package, stable context ordering, and backward-compatible Git behavior.

## 12. Interfaces and contracts

**Purpose:** Convert cwd, HOME, and bounded VCS root-probe outcomes into one ordered list of eligible context directories.

**Callers:** The `before_agent_start` handler.

**Contracts:** Root probing is injected for tests; returned roots must be valid ancestors of cwd; the deepest valid root wins; operational uncertainty narrows discovery to cwd; directory order is broad-to-near; HOME itself is excluded.

**Reason for depth:** Root resolution combines external processes, nested repositories, path containment, and prompt injection boundaries. Keeping it behind a small plain-data interface makes failure behavior testable without invoking real VCS processes.

## 13. State
No persistent state is added. Discovery occurs from the current turn's cwd and filesystem. Probe results may be scoped to one resolution but must not leak across different working directories.

## 14. Dependencies
- `[COMPOSE] jj root --ignore-working-copy` — reports the nearest Jujutsu workspace root without snapshotting the working copy.
- `[COMPOSE] git rev-parse --show-toplevel` — reports the nearest Git worktree root.
- `[EXTEND] extensions/local-agent-context/index.ts` — existing ordering and prompt composition.
- `[RETAIN] Pi native context loader` — owns global `~/.pi/agent/AGENTS.md`.
- No new package.

## 15. Failure modes
A probe hangs, an executable is missing, a command returns a non-ancestor path, Git and Jujutsu report differently nested roots, HOME is missing or unusable, a symlink defeats lexical containment, traversal includes HOME, context above the selected root loads, or ordering changes.

## 16. Observability
Focused tests expose selected boundaries and loaded paths. Runtime probe errors remain non-fatal and do not append diagnostic text to the model prompt.

## 17. Acceptance criteria
### Scenario: Pure Jujutsu repository
**Given** cwd is nested beneath a pure Jujutsu root and unrelated context exists above it
**When** local context is loaded
**Then** the Jujutsu root is included and no context above it appears.

### Scenario: Colocated repository
**Given** Git and Jujutsu report the same root
**When** local context is loaded
**Then** that shared root is included exactly once.

### Scenario: Differently nested repositories
**Given** Git and Jujutsu report different valid ancestor roots
**When** local context is loaded
**Then** the root nearest cwd is included and context above it is excluded.

### Scenario: Git-only compatibility
**Given** Git reports a root and Jujutsu reports no repository
**When** local context is loaded
**Then** the existing inclusive Git-boundary behavior is preserved.

### Scenario: No repository inside HOME
**Given** cwd is below HOME and neither VCS reports a repository
**When** local context is loaded
**Then** eligible ancestors are loaded broadest-first up to but excluding HOME.

### Scenario: Cwd outside HOME
**Given** cwd is outside HOME
**When** neither VCS reports a repository
**Then** only cwd is inspected.

### Scenario: Probe uncertainty
**Given** no valid root is returned and a root probe times out or cannot execute
**When** local context is loaded
**Then** only cwd is inspected and the turn continues.

### Scenario: Existing order remains stable
**Given** eligible directories contain both supported filenames
**When** context is appended
**Then** broader directories precede nearer directories, local precedes override within each directory, and Pi's original system prompt remains first.

### Scenario: No eligible content
**Given** eligible files are missing, empty, or whitespace-only
**When** the agent starts
**Then** the extension returns no prompt modification.

## 18. Automated verification
- `node --test extensions/local-agent-context/index.test.ts`
- `npm run check`
- `bash scripts/lib/plan-consistency-check.sh .specs/epics/e04-repository-bounded-local-agent-context/`

## 19. Implementation steps
1. Add injected root-probe contracts for pure Jujutsu, Git-only, colocated, differently nested roots, invalid output, timeout, and executable failure → verify: `node --test extensions/local-agent-context/index.test.ts`
2. Add HOME-boundary contracts for inside-HOME exclusion, outside-HOME cwd-only behavior, missing HOME, ordering, and empty files → verify: `node --test extensions/local-agent-context/index.test.ts`
3. Implement bounded root probing, deepest-valid-root selection, canonical containment, and fail-closed traversal while preserving prompt composition → verify: `node --test extensions/local-agent-context/index.test.ts`
4. Update README wording and run package-wide regression and type checks → verify: `npm run check`

## 20. Definition of done
Pure Jujutsu, Git-only, colocated, and differently nested repositories stop at the nearest valid root; no-repository traversal excludes HOME; outside-HOME and uncertain discovery inspect only cwd; existing ordering and blank-file behavior remain green; native global context is not duplicated; and the full package passes.

## Prior Art

**Verdict: compose existing VCS root commands and extend the current extension.**

- `jj root --ignore-working-copy` reports the current workspace root and avoids Jujutsu's default working-copy snapshot. Local evidence: `jj root --help` from the installed Jujutsu CLI.
- `git rev-parse --show-toplevel` reports the current Git worktree root and fails outside a Git repository. Local evidence: installed Git CLI behavior.
- `extensions/jj-status/index.ts` already establishes a repository convention for bounded Jujutsu execution and injectable command-result contracts.
- Pi already loads `~/.pi/agent/AGENTS.md` globally. The extension should not duplicate that file or invent global local/override variants. Evidence: installed Pi `README.md`, `docs/usage.md`, and `docs/security.md`.
- A filesystem-only `.git` check is insufficient for pure Jujutsu repositories and Git worktree marker files. No dependency is needed.
