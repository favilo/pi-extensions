# Threat Model — e07 Bash subcommand permission evaluation

## Scope

This threat model covers parsing compound Bash invocations, evaluating each executable command unit against existing permission rules, making one atomic authorization decision, and returning/auditing denial evidence. The first story is an exploratory parser spike; production parsing and enforcement begin in e07s02.

In scope:

- Shell lists, pipelines, redirects, substitutions, functions, loops, nested shells, quoted arguments, and explicit `bash -c` payloads.
- Source-span preservation and normalized permission inputs.
- Binding authorization to the effective Bash executable, exact command, and effective working directory used by execution.
- Per-subcommand allow, deny, and ask evaluation.
- Atomic denial of the complete Bash invocation.
- Agent-facing denial details and audit records.

Out of scope:

- Partial execution of approved subcommands.
- Non-Bash tool permissions.
- Treating parser output as the command to execute.

## Assets and trust boundaries

| Asset | Boundary / concern |
|---|---|
| User machine, repository, and credentials | Model-authored shell text is untrusted and reaches a command-execution sink only after authorization. |
| Permission policies | Parsed units must match the same executable semantics that Bash will run; parser uncertainty must never widen authorization. |
| Bash execution identity | The renderer currently constructs `createBashTool(cwd)` without custom options, so Unix execution resolves through Pi's default `/bin/bash`, then `bash` on `PATH`, then `sh` fallback. Authorization must not silently assume a different executable or transformed command. |
| Original command text | The exact authorized invocation must remain unchanged between evaluation and execution. |
| User approval | An ask for one command or component must not authorize hidden substitutions, redirects, nested payloads, or later components. |
| Audit records and agent results | Evidence must identify the blocked unit without leaking secrets from arguments, environment assignments, or substitutions. |
| Parser dependency | A third-party parser becomes part of a security boundary and may be incomplete, abandoned, malicious, or vulnerable to resource exhaustion. |

## Abuse cases and required mitigations

### Parser/Bash semantic divergence — HIGH — CWE-78 / CWE-20

An attacker-controlled command may exploit syntax the selected parser interprets differently from the installed Bash version. The permission layer could approve an apparently safe unit while Bash executes an additional command.

**Required mitigation:** Define a closed supported grammar from a representative corpus. Reject parser errors, recovery nodes, unknown node kinds, incomplete spans, and uncertain semantics. Pin and review the parser dependency. Test supported constructs against real Bash parsing/execution observations without executing destructive payloads.

### Hidden execution in substitutions and expansions — HIGH — CWE-78

Command substitutions, process substitutions, arithmetic expansions, aliases, functions, traps, sourced files, `eval`, and nested `bash -c` payloads can execute commands not visible in a naive top-level command list.

**Required mitigation:** Either recursively extract and evaluate every executable payload with complete source provenance or classify the construct as unsupported and require an explicit whole-command approval. Never auto-allow opaque dynamic code such as `eval`, `source`, or runtime-generated `bash -c` text.

### Authorization/execution mismatch — HIGH — CWE-367

Normalization may alter quoting, separators, redirects, globbing, or argument boundaries. The resolved shell executable, command prefix, spawn hook, working directory, environment, or executed command may also differ from what authorization evaluated.

**Required mitigation:** Resolve or capture the effective execution context before authorization. Bind the decision to the shell executable and arguments, immutable original or transformed command, effective cwd, and all security-relevant environment changes. Use normalized text only for display and stable matching where semantics are proven equivalent. Execute exactly once through that bound context only after every unit is allowed; any mismatch or later transformation fails closed.

### Non-atomic compound execution — HIGH — CWE-863

If allowed components execute before a later component is denied, denied behavior may still be reached through state changes, pipelines, or shell control flow.

**Required mitigation:** Parse and authorize the complete invocation before calling the Bash tool. If any component is denied, asks without available UI, or is unsupported, execute nothing. Add tests asserting the execution adapter is never called on aggregate denial.

### Redirect and environment side effects omitted from policy — HIGH — CWE-78 / CWE-73

A command name may be safe while redirects overwrite sensitive files, environment assignments alter loaders, or here-documents feed dangerous payloads.

**Required mitigation:** Include redirects, assignments, here-documents, and their targets in the syntax contract and permission input. Unsupported or dynamically resolved targets fail closed. Do not authorize solely from command-name tokens.

### Explicit `bash -c` argument confusion — HIGH — CWE-88

Incorrectly identifying the `-c` payload or positional arguments can leave nested commands unchecked, especially with combined flags, `--`, empty `$0`, or multiple shell layers.

**Required mitigation:** Parse Bash option semantics explicitly, recurse into only the actual `-c` payload, preserve its original quoting/source span, and test combined flags, terminators, positional arguments, and nested shells. Unrecognized invocation shapes fail closed.

### Parser denial of service — MEDIUM — CWE-400

Deep nesting, huge here-documents, or pathological syntax may consume excessive CPU or memory in the interactive permission path.

**Required mitigation:** Set command-size, nesting-depth, node-count, and parse-time limits. Treat limit exhaustion as unsupported and deny/ask according to the fail-closed contract. Never block the TUI indefinitely.

### Secret leakage through denial and audit details — MEDIUM — CWE-532

Commands may contain tokens, passwords, private paths, here-document contents, or environment values. Per-component auditing increases duplication and exposure.

**Required mitigation:** Define redaction before e07s03. Prefer source spans, command identity, and safe summaries over raw secret-bearing arguments. Apply the same redaction to UI, agent-facing results, debug logs, and component/aggregate audit entries.

### Misleading source spans or denial attribution — MEDIUM — CWE-451

Invalid byte/character offsets, Unicode, multiline input, or normalized text can highlight a different command than the one denied, causing unsafe user approval on retry.

**Required mitigation:** Keep offsets in one documented coordinate system, test Unicode and multiline commands, verify every span round-trips to the original source, and fail closed when provenance cannot be established.

### Dependency supply-chain compromise — MEDIUM — CWE-1104

A parser package may be unmaintained or introduce transitive install/runtime risk in the permission boundary.

**Required mitigation:** The spike must record maintenance activity, ownership, license, dependency tree, release cadence, and bundle impact. Pin versions through the lockfile and prefer the smallest maintained parser with no runtime code generation.

## Security review result

No production parsing or authorization code exists yet, so the current planning change introduces no exploitable runtime path. E07 is nevertheless **HIGH risk** because parser output will influence command execution authorization.

**Verdict:** PASS for e07s01 exploratory work only. E07s02 is blocked until the spike proves a closed syntax contract, fail-closed unknown-node handling, original-command binding, aggregate atomicity, nested payload handling, and bounded parser resource use. E07s03 must define redaction before recording raw component text.

## Verification obligations

- Build a corpus covering lists, pipelines, redirects, substitutions, functions, loops, nested shells, multiline/Unicode input, and malformed syntax.
- Prove explicit `bash -c` payload extraction for flags, `--`, `$0`, positional arguments, and nesting.
- Prove unsupported syntax, parser recovery, limit exhaustion, and incomplete source spans cannot auto-allow.
- Prove authorization and execution use the same resolved Bash executable, arguments, command text, effective cwd, and security-relevant environment; any mismatch fails closed.
- Prove aggregate denial calls no execution adapter and the authorized command executes exactly once only after complete approval.
- Prove source spans round-trip to the original command.
- Define and test redaction for environment assignments, arguments, here-documents, and nested payloads before audit expansion.
