# Threat Model — e12 Global context router

## Scope

This threat model covers the parent-session `extensions/context-router/` package extension: its startup and per-turn active-tool baseline, `find_tools`, `find_skills`, skill-catalog prompt sanitization, count-only diagnostics, and its composition with `tool-permissions`, MCP registration, and parent `subagent` registration.

In scope:

- Parent Pi `getAllTools`, `getActiveTools`, and `setActiveTools` state at session start, finder execution, and `turn_start`.
- Bounded, deterministic, redacted registered-tool and loaded-skill projections sent to the model.
- Exact canonical skills-section removal in `before_agent_start`.
- Finder authorization through the existing generic custom-tool policy route.
- Package load order and late MCP/custom registration.

Out of scope:

- Changing Pi core, provider request payloads, provider-native deferred loading, or tool-definition schemas.
- Automatic skill selection, persisted selection files, startup LLM calls, or a new dependency.
- Child-private bridge catalogs, child authorization, or e06 lifecycle changes.
- Altering configured allow/deny semantics, approval prompts, or audit retention in `tool-permissions`.

## Assets and trust boundaries

| Asset | Boundary / concern |
| --- | --- |
| Active parent tool set | Determines which capabilities and schemas reach the next model turn. |
| Registered tool metadata | Is extension-local source data; parameters and arbitrary source paths may disclose unnecessary implementation detail. |
| Loaded skill metadata and SKILL.md bodies | Metadata is needed for discovery; full bodies are intentionally absent until the model uses `read` on a selected path. |
| System prompt | Contains unrelated Pi and earlier-extension instructions that must survive skill-catalog removal byte-for-byte outside the one canonical stanza. |
| Permission policy and approval | `tool-permissions` is the only authorization boundary for finder calls and selected tools. |
| Session selection state | Must be parent-session scoped, additive during a finder call, and cleared on shutdown/reload. |
| Child bridge catalog | A constrained e06 private surface that this extension must never enumerate or mutate. |

## Abuse cases and required mitigations

### Unselected late tool reaches a model request — HIGH — CWE-284 / CWE-362

Pi refreshes late `registerTool()` registrations into the active set. An MCP/custom capability could therefore enter the next model request without a finder selection.

**Required mitigation:** On `session_start` and before every `turn_start`, derive the active set from the exact registered-name intersection of the fixed baseline plus names selected in this parent session. Drop unregistered selections. Never reset tools while a finder executes; `find_tools` itself performs only an additive `setActiveTools()` update, so Pi can attach deferred definitions to its result.

### Discovery becomes an authorization bypass — HIGH — CWE-863

A finder could directly execute, proxy, auto-allow, or otherwise activate a capability in a way that skips configured deny, configured allow, prompt, or headless failure behavior.

**Required mitigation:** Register both finders as ordinary custom tools and make no `tool_call` interception or policy exception. Let the existing generic known-custom-tool branch decide finder execution. Tool selection changes prompt visibility only; every selected tool still undergoes its normal authorization at execution. Prove configured allow, deny precedence, and no-UI unmatched denial for both finder names.

### Tool schemas, skill bodies, policies, or secrets leak through discovery — HIGH — CWE-200 / CWE-532

The model-visible discovery result, prompt metric, source metadata, or debug output might serialize `parameters`, a skill body, a policy record, tool input, token, or credential-shaped data, defeating the context reduction and disclosing sensitive details.

**Required mitigation:** Project only normalized bounded name, description, and redacted source category for tools, and name, bounded description, and SKILL.md path for skills. Do not retain or serialize parameters, raw source paths, policy/input values, skill bodies, or credentials. The debug command reports counts, byte deltas, and an enum-only sanitizer outcome; it never lists catalog entries. Add disclosure-negative tests.

### Metadata prompt injection or resource exhaustion — MEDIUM — CWE-74 / CWE-400

An extension or skill can supply excessively long or control-character-bearing metadata that becomes model-visible discovery content, changes ranking nondeterministically, or exhausts context.

**Required mitigation:** Normalize whitespace/control characters, impose per-field and result-count bounds, score only normalized name/description/source text, and use deterministic score/name tie-breaks. Return plain data rather than instructions and never use descriptions as system-prompt additions.

### Prompt sanitizer removes unrelated instructions or fails open — HIGH — CWE-20

A substring or regex replacement could remove a user prompt, local context, or another extension's content; an absent/multiple rendering might silently corrupt the prompt.

**Required mitigation:** Render the exact canonical source stanza with `formatSkillsForPrompt(event.systemPromptOptions.skills)` and replace it only when it occurs exactly once. Zero or multiple occurrences preserve the original prompt and record only an enum/count diagnostic. Do not reconstruct the prompt or inspect provider payloads.

### Explicit skill invocation is disabled — MEDIUM — CWE-754

Interception of raw input could prevent Pi's `/skill:name` expansion or change its authority/lifecycle.

**Required mitigation:** Do not register an `input` handler. Cache structured skill metadata only inside `before_agent_start`, after Pi's normal expansion phase. Test a simulated explicit invocation remains on Pi's normal path and a returned SKILL.md path is readable through the already-baseline `read` tool.

### Cross-session selection retention or child-bridge scope expansion — MEDIUM — CWE-639

A global catalog or stale closure may carry selected tools into another session, or discovery could enumerate the child-only bridge.

**Required mitigation:** Keep selection and skill metadata in one extension-instance/session-local coordinator, clear it on `session_shutdown`, enumerate only `pi.getAllTools()` for the parent runtime, and do not import or mutate `tool-registry`/child session definitions. Verify shutdown/reload and subagent bridge noninterference.

## Security review result

**Planning verdict: PASS WITH IMPLEMENTATION OBLIGATIONS.** The supported Pi APIs can enforce the requested small parent context without modifying authorization or child lifecycle. Implementation is blocked until behavioral RED tests cover every mitigation above, particularly late registration, exact-one prompt matching, finder policy routing, and negative disclosure assertions.

## Verification obligations

- Prove the first parent model turn contains exactly the registered baseline and that an unselected late tool is absent before the next turn.
- Prove `find_tools` adds only explicitly selected matching registered names and emits no parameter schema.
- Prove catalog ranking, redaction, field limits, and tie order are deterministic.
- Prove `find_skills` exposes only bounded metadata/path records and no body; `/skill:name` expansion remains unchanged.
- Prove canonical skills replacement succeeds once and absent/ambiguous canonical stanzas preserve the whole prompt.
- Prove configured allow, configured deny, and no-UI default behavior for both finders use the existing generic policy path.
- Prove diagnostics contain counts, byte deltas, and sanitizer outcome only.
- Prove package order is last and the subagent private bridge/authorization behavior is unchanged.
