# e14s01 — Add ast-grep structural search tool extension

## User need
Agents searching code with line-oriented `grep` miss structural matches and drown in noise. An `ast-grep` tool gives agents fast, syntax-aware code search so they find definitions, call sites, and patterns directly.

## Requirements
- ADDED: An extension registers an `ast-grep` tool that runs structural search patterns against the current working directory and subdirectories.
- ADDED: The `tool-permissions` extension treats `ast-grep` with the same path policy as `read`, `grep`, `ls`, and `find`: implicit allowance inside the current working directory and subdirectories, configurable path rules elsewhere.
- ADDED: The `built-in-tool-renderer` extension renders `ast-grep` calls and results consistently with the existing `grep` rendering (pattern, paths, line numbers, match regions).
- ADDED: The tool is only registered when the `ast-grep` binary is discoverable on `$PATH`; when absent, the extension loads without registering the tool and emits a warning that the extension is available but the `ast-grep` program is not installed.
- ADDED: The tool description points agents at structural (syntax-tree) search so the existing user-level ast-grep skill applies when the agent composes patterns.
- Search results are bounded so a broad pattern cannot flood the agent context.

## Acceptance criteria
- The agent can invoke the ast-grep tool with a pattern and receive matching code regions with file paths and line numbers.
- Invocations inside the working directory do not trigger a permission prompt; invocations targeting paths outside it follow the existing read-tool permission policy.
- Tool calls and results render in history with the same clarity as `grep` output.
- A session without `ast-grep` on `$PATH` loads the extension, shows a warning that the program is missing, and the tool does not appear in the agent's available tool list.
- Result output is truncated at a documented bound with a visible truncation marker.

## Verification
- `node --test extensions/ast-grep/index.test.ts`
- `node --test extensions/tool-permissions/ast-grep-permission.test.ts`
- `node --test extensions/built-in-tool-renderer/result.test.ts`
- `npm run check`
