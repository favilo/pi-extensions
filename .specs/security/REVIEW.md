# Security Review — e03s01 Trusted Hierarchical Project Permissions

- Reviewed: 2026-07-30T17:36:00Z
- Scope: working-tree changes for e03s01
- Result: **PASS — no reportable HIGH findings**

Reviewed project-policy discovery, persisted trust resolution, canonical path containment, TOML parsing, precedence, and tool-handler routing.

Controls verified:

- Project policy is loaded only under the nearest explicit persisted trusted path.
- False, missing, malformed, or unreadable trust data falls back to user policy.
- Repository traversal is bounded by the nearest `.git` or `.jj` marker.
- Resolved policy paths are canonicalized and rejected when a symlink escapes the trusted path.
- Malformed eligible project policy does not fall through to a broader policy.
- No new command execution, network boundary, credential handling, or deserialization format was introduced.

No credential-shaped values or reportable injection, traversal, authorization-bypass, or unsafe-deserialization findings were found.

## e08s01 Windows preflight portability

- Reviewed: 2026-08-14T00:00:00Z
- Scope: `fix/windows-preflight` portability fixtures, preflight test selection, and audit alias fallback
- Result: **PASS — no reportable HIGH findings**

The change preserves canonical subagent containment and permission evaluation. Audit writes remain authoritative in dated files; symbolic-link failure falls back to a same-directory hard link, and alias/retention maintenance cannot block authorization. The preflight configuration excludes optional examples without modifying their source test. No new command execution, network, credential, or deserialization boundary was introduced.

## e03s02 scoped permission saves

- Reviewed: 2026-07-30T21:34:01Z
- Scope: current jj working-copy diff
- Result: **PASS — no reportable HIGH findings**

The new project-save destination is gated by persisted trust and canonical path containment. User and project targets are selected explicitly, persistence errors return before the permission result is completed, and no new shell, network, credential, or deserialization boundary was introduced. The shortcut ordering handles `ctrl+shift+a` before `ctrl+a`.

## e06s01 AgentSession spike

- Reviewed: 2026-08-04T23:02:00Z
- Scope: `main..@` changes for the isolated subagent spike
- Result: **PASS — no reportable HIGH findings**

The spike passes explicit child `cwd` and parent context to the SDK session, disposes sessions in a `finally` block, propagates cancellation to the child abort hook, bounds nesting, and routes authorization through the existing tool-permissions resolver. The proof harness uses no shell execution, network boundary, credential handling, or new deserialization format. No reportable command-injection, path-traversal, authorization-bypass, secret-exposure, or unsafe-deserialization finding was identified.

## e06s02 Permission-enforced subagent runtime

- Reviewed: 2026-08-06T20:15:00Z
- Scope: `extensions/subagent/` and `extensions/tool-permissions/` permission bridge
- Result: **PASS — no reportable HIGH findings**

Child tool requests are schema-validated and routed through the existing resolver and audit logger. Child sessions expose only the permission bridge, reject direct SDK/process execution paths, fail closed when UI is unavailable, bound nesting, and dispose on success, failure, and cancellation. No new shell, network, credential, or unsafe-deserialization boundary was introduced.

## e06s03 Subagent working-directory enforcement

- Reviewed: 2026-08-10T21:03:19Z
- Scope: `resolveSubagentCwd` and effective-cwd propagation through the subagent permission bridge
- Result: **PASS — no reportable HIGH findings**

Parent and requested child directories are resolved with `realpathSync`, verified as directories, and checked for canonical containment before a child session starts. Missing paths, non-directories, absolute escapes, `..` traversal, and symlink escapes fail closed. The canonical child cwd is used to construct built-in tools, evaluate recursive project policy, and attribute audit entries. No new dependency, command parser, network boundary, credential handling, or unsafe deserialization was introduced.

## e06s04 Missing permission UI and prompt cancellation

- Reviewed: 2026-08-11T12:40:00Z
- Scope: `szzuxrsr..qnqpxknk` subagent permission prompt and unavailable-UI handling
- Result: **PASS — no reportable HIGH findings**

Unlisted child actions fail closed when the parent has no dialog-capable UI: the real parent adapter now omits its prompt callback, causing the shared boundary to return a structured `denied` result with reason `unavailable_ui` without executing or persisting policy. The result exposes only actor, tool name, effective cwd, a fixed action summary, and optional steering; raw tool input is excluded. Explicit allow and deny rules remain authoritative before the prompt path. Escape resolves the existing TUI prompt as `cancel`, and the boundary maps that result to `cancelled` without execution. No dependency, shell, network, credential, path, or deserialization boundary changed, and no injection, authorization-bypass, secret-exposure, or unsafe-deserialization finding met the reporting threshold.

## e18s01 WASM path trust and .aiignore

- Reviewed: 2026-11-07T02:59:49Z
- Scope: `main..@-` path-trust changes in `extensions/tool-permissions/native/crates/tool-permissions-native/src/path_trust.rs`, `extensions/tool-permissions/native-path-trust.ts`, and the path decision in `extensions/tool-permissions/index.ts`
- Result: **PASS — no reportable HIGH findings**

The WASM path-trust operation canonicalizes through a host `realpath` callback, reads only project policy files and `.aiignore`, and does not spawn a process or open a network connection. Invalid contract output becomes `deny` on the shared boundary and a blocked path resolution on the registered tool handler. Project policy is skipped when the canonical policy path is outside the trusted root. A gitignore build or line error denies. An unreadable trust record does not become an allow.

No command injection, path-traversal allow, authorization bypass, secret exposure, or unsafe deserialization finding reached confidence 8.

## e18s01 registered handler re-review

- Reviewed: 2026-11-09T17:05:08Z
- Scope: `canonicalPermissionPath`, `handlePathPermission`, and `handleFileEditPermission` in `extensions/tool-permissions/index.ts`, plus `adoptPathTrust` in `extensions/tool-permissions/native-path-trust.ts`
- Result: **PASS — no reportable HIGH findings**

On a ready WASM result, the registered read, write, and edit handlers keep the WASM canonical path and apply `nativeDecision` before the prompt. A configured deny still returns before a WASM allow. A WASM deny, including an `.aiignore` match on write or edit, returns before the no-UI ask. An invalid `.aiignore` line or an unreadable project policy returns ask with a diagnostic. That ask blocks when no UI is available and prompts when a UI is available, so the user can allow one call that fixes the file. Invalid contract output throws and the handler blocks path resolution. A missing native package stays on the TypeScript path decision. The WASM evaluator does not spawn a process. The host `readFile` callback remains limited to the path the native package requests for policy and `.aiignore` reads.

The earlier note that the registered handler ignored the WASM decision is closed. No new HIGH finding at confidence 8 or above.

## e18s02 WASM audit writes

- Reviewed: 2026-11-10T22:43:30Z
- Scope: `wlpruqvu..@` audit changes in `extensions/tool-permissions/native/crates/tool-permissions-native/src/audit.rs`, `extensions/tool-permissions/native-audit-write.ts`, `extensions/tool-permissions/audit.ts`, and `audit()` in `extensions/tool-permissions/index.ts`
- Result: **PASS — no reportable HIGH findings**

WASM builds one JSON line from the supplied decision fields and appends it through the host callback. It does not open the log itself, spawn a shell, open a network connection, or copy `permissions.toml` into the record. The host chooses the dated log path from its own home directory. A failed append returns `ok: false`, `records: 0`, and `decision: deny`. Invalid contract output is not accepted as a successful write. When the native package path resolves, the host skips the TypeScript writer, so the success path does not append a second copy.

`index.ts` `audit()` does not apply the returned deny to the tool result. The permission decision is made before the audit write, and the existing TypeScript logger also warns and leaves that decision unchanged. Moving tool execution is outside this story. No command injection, path-traversal allow, authorization bypass, secret exposure, or unsafe deserialization finding reached confidence 8.

## e18s03 WASM rule saves

- Reviewed: 2026-11-13T00:24:52Z
- Scope: `txkuorvq..nzmoroxu` rule-save changes in `extensions/tool-permissions/native/crates/tool-permissions-native/src/rule_save.rs`, `extensions/tool-permissions/native-rule-save.ts`, `saveToolPermissionRule` in `extensions/tool-permissions/index.ts`, and `saveSubcommandAllowRules` in `extensions/tool-permissions/bash-subcommands.ts`
- Result: **PASS — no reportable HIGH findings**

WASM `save_rule` returns patched TOML text. It does not open the destination, spawn a process, or open a network connection. The host reads the selected file, accepts the patched text only when the contract, nonce, `ok`, and `allowed` match, and replaces the destination through a temporary file and `rename`. A failed read, patch, or replace returns `ok: false` and `allowed: false`. The failed-save test kept the previous file bytes. The prompt returns before `allow_pattern` when that save returns false.

When the native package path resolves, the host does not also call `saveAllowedRule`, so the success path does not append a second copy. A missing package still uses the TypeScript saver until e18s06. The host chooses the destination: a project save uses the trusted project policy path, and an untrusted directory is refused before the save. Rule values are parsed as a JSON object of strings, checked as regular expressions, and written as TOML strings. An invalid rule or file shape errors and is not written. A repeated rule stays one allow entry.

No command injection, path-traversal allow, authorization bypass, secret exposure, or unsafe deserialization finding reached confidence 8.

## e18s04 WASM prompt queue

- Reviewed: 2026-11-16T18:56:11Z
- Scope: `uqppwwxz..@-` prompt changes in `extensions/tool-permissions/native/crates/tool-permissions-native/src/prompt_queue.rs`, `extensions/tool-permissions/native-prompt-queue.ts`, and `askScrollablePermission` in `extensions/tool-permissions/index.ts`
- Result: **PASS — no reportable HIGH findings**

The native queue binds each host callback to the tool-call id captured when that prompt opens. A UI rejection or a thrown presenter resolves `ok: false`, `decision: deny`, and no steering, then releases the next queued prompt. `presentBoundPrompt` accepts a result only when the version, operation, nonce, and tool-call id match the request. A mismatched or malformed result becomes deny. The queue rejects a second N-API environment while work is queued. The `FunctionRef` lifetime erasure is confined to that queue, checked against the captured environment, and used only to attach `then` and `catch`.

`askScrollablePermission` does not call this queue yet. The live prompt still uses `PermissionPromptQueue`. That is a missing integration, not an allow bypass: the existing TypeScript queue still serializes the visible prompt. No command injection, path-traversal allow, authorization bypass, secret exposure, or unsafe deserialization finding reached confidence 8.

## e18s04 live prompt routing

- Reviewed: 2026-11-17T19:42:40Z
- Scope: `vuwmxvln` in `askScrollablePermission` and `presentBoundPrompt` (`extensions/tool-permissions/index.ts`, `extensions/tool-permissions/native-prompt-queue.ts`)
- Result: **PASS — no reportable HIGH findings**

On a loaded native package, `askScrollablePermission` sends the prompt through `presentBoundPrompt` and keeps `PermissionPromptQueue` for load failure only. The host accepts a result only when `ok` is true and the tool-call id, decision, and steering match the prompt that opened. A mismatched id, a malformed result, or a thrown presenter becomes deny. A parent abort or session shutdown cancels the open prompt before the next queued prompt is presented. The queue id is the tool-call id when one exists, and otherwise a fresh `randomUUID` request id. The nonce remains the existing host/module contract value, not a credential.

No command injection, path-traversal allow, authorization bypass, secret exposure, or unsafe deserialization finding reached confidence 8. The earlier missing-integration note is closed.
