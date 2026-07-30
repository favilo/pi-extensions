# e04s01 Repository and Home Boundaries — Impact Assessment

## Target

- `extensions/local-agent-context/index.ts`: ancestor discovery, repository-root selection, and local context loading.
- `extensions/local-agent-context/index.test.ts`: public extension behavior for context order and traversal boundaries.
- `README.md`: user-facing description of local context discovery.

## Zoom-out

### Purpose

The local-agent-context extension appends non-empty `AGENTS.local.md` and `AGENTS.override.md` files to Pi's existing system prompt. It supplies directory-specific guidance while leaving Pi's native `AGENTS.md` and `CLAUDE.md` loading unchanged.

### Callers

- Pi loads the extension through `package.json` and invokes its `before_agent_start` handler.
- The handler resolves directories from `ctx.cwd`, reads local context files, and returns an augmented system prompt.
- The focused test suite invokes the extension through a fake `ExtensionAPI` event registration boundary.

### Contracts

- Broader eligible guidance appears before nearer guidance.
- Within one directory, `AGENTS.local.md` appears before `AGENTS.override.md`.
- Missing, empty, and whitespace-only files do not alter the prompt.
- Pi's native global `~/.pi/agent/AGENTS.md` remains outside this extension's responsibility.
- Repository and HOME ceilings must prevent unrelated ancestor guidance from entering the prompt.

## Dependents (4)

- `package.json`: loads the extension in every Pi session using this package.
- `extensions/local-agent-context/index.test.ts`: characterizes the extension's public behavior.
- `README.md`: advertises the extension and must describe its bounded behavior accurately.
- `.specs/epics/archive/e02-extension-unit-coverage/e02s01-extension-unit-contracts.md`: historical Git-boundary characterization superseded, not rewritten, by e04s01.

## Affected Stories

- `e04s01`: owns repository command discovery, HOME fallback, failure behavior, and regression coverage.
- `e02s01`: remains archived; its Git-only contract becomes a compatibility baseline rather than the complete boundary contract.
- `e03s01`: depends conceptually on repository-boundary precedent but owns separate tool-permission discovery and must not import e04 implementation implicitly.

## Test Coverage

Existing coverage:

- `extensions/local-agent-context/index.test.ts` covers a Git-directory boundary, broad-to-near ordering, local-before-override ordering, trimming, empty-file omission, and no-op behavior.
- `npm run check` covers package TypeScript and all extension tests.

Required coverage:

- Pure Jujutsu root discovery.
- Git-only and colocated Git/Jujutsu compatibility.
- Differently nested Git and Jujutsu repositories, selecting the nearest valid returned root.
- Exclusion of files above every selected repository root.
- No-repository traversal stopping before `$HOME` when cwd is inside HOME.
- Cwd-only behavior when cwd is outside HOME.
- Cwd-only fail-closed behavior when VCS root discovery times out or cannot execute.
- Rejection of command output that is not an ancestor of cwd.
- Existing ordering, trimming, empty-file, and unchanged-prompt contracts.

Coverage gaps:

- Existing tests expose no injectable VCS command boundary.
- No test currently distinguishes no repository from root-probe operational failure.
- No current test covers HOME containment or cwd outside HOME.

## Risk: Medium

The extension has one runtime caller and focused tests, but current coverage is partial and an incorrect boundary can inject unrelated instructions into every agent turn. External root probes also introduce timeout, executable-availability, and invalid-output failure modes.

## Recommended action

Proceed with contract-first TDD. Inject root probes, cap each probe at 1,000 ms, choose the deepest valid ancestor returned by Git or Jujutsu, and fall back to cwd-only behavior on operational uncertainty. Preserve the archived e02 evidence and e03 capsule unchanged.
