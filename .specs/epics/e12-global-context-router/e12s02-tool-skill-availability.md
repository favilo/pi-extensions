# e12s02 — Expose the full tool and skill landscape while keeping every tool callable

## 1. Identity

- **Story:** e12s02
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 9
- **Risk:** P0
- **Delta:** ADDED
- **WSJF:** 5.4 (provisional — (business value 10 + time criticality 10 + risk reduction 7) / job size 5; user priority: the model must know what tools and skills exist and be able to use them without a discovery round-trip)

## 2. User need

The e12s01 router made the initial context small but too restrictive: the model could not call a tool unless it was first discovered through `find_tools` and deliberately activated. In practice `subagent_result` was unusable from the start, and the model had no idea which tools and skills were installed. Users with globally installed MCP providers, async-loading Codex tools, and a large skill catalog need the model to see what is available — summaries of every non-MCP tool plus the names of suppressed tools and skills — while still being able to call any tool without a discovery round-trip.

## 3. Goal

Extend `extensions/context-router/` so the parent system prompt carries a bounded but complete picture of the installed landscape: one-line summaries of every registered non-MCP tool, a compressed XML list of suppressed tool names, and a compressed XML list of skill names. Every non-MCP tool remains callable even when it is not in the active set, reversing the e12s01 decision that left `subagent_result` inactive at startup. MCP tools (added by plugins) and async-registered tools (Codex) are handled explicitly rather than bypassing the router's registry.

## 4. Non-goals

- Serializing tool parameter schemas, skill bodies, prompt guidelines, policies, tool inputs, tokens, or credential-shaped data into the new prompt sections or discovery output.
- Patching Pi core or rewriting provider request payloads.
- Automatic skill selection, persisted selection files, or an LLM call during startup.
- Changing permission-policy evaluation, auto-allow behavior, approval UX, or audit retention.
- Enumerating or changing the child-private `subagent-tool-request` bridge catalog.
- Making MCP tool summaries verbose in the prompt; MCP tools remain discoverable through `find_tools` and appear only as suppressed names in the prompt.

## 5. Requirements

#### ADDED: Non-MCP tool summaries in the system prompt

- In `before_agent_start`, append a system-prompt section listing every registered non-MCP tool as a one-line summary of normalized name and bounded description.
- The summary must not include a parameter schema, prompt guideline text, raw source path, policy, input, token, or credential-shaped value.
- Full tool definitions remain available through the existing `find_tools` discovery; the summary is a pointer, not a replacement for the definition.

#### ADDED: Compressed XML of suppressed tool names and skill names

- Append a compressed XML list of the names of suppressed tools (registered but not active), including MCP tools and every unselected custom tool.
- Append a compressed XML list of the names of loaded skills.
- The lists use the same XML style as Pi's canonical skills section and are bounded, deterministic, and free of descriptions, paths, bodies, and schemas.
- The model is told that a suppressed tool can be activated through `find_tools` and a skill's instructions can be read through `find_skills` + `read`.

#### ADDED: Every non-MCP tool is callable even when not active

- The router must not make a registered non-MCP tool uncallable merely because it is not in the active set; `subagent_result` is callable from the start (reverses the e12s01 "Activating `subagent_result` at startup — decided" non-goal).
- The router keeps the prompt bounded (summaries + compressed XML) while preserving callability for all non-MCP tools.
- MCP tools remain discoverable and may be activated through `find_tools`; their callability follows the mechanism resolved in the open design questions (see §11).

#### ADDED: Explicit MCP tool handling

- MCP tools are identified by a defined mechanism (see §11 open questions) and are excluded from the non-MCP summary list.
- MCP tool names appear in the compressed suppressed-tool list.
- MCP tools registered asynchronously after startup are handled deterministically at the next turn boundary.

#### ADDED: Async-registered and prompt-direct tools (Codex)

- Tools that register asynchronously after startup (e.g. machine-local Codex MCP/Apps tools) must be visible in the router's landscape: either registered through the router's registry or detected from the prompt, and included in the appropriate summary/suppressed sections.
- Tools that add themselves to the system prompt directly instead of registering through `getAllTools()` must be fixed so they flow through the router's registry, or detected and handled without duplication or disclosure.
- The router must not double-list a tool that appears both in the registry and in the prompt.

#### ADDED: Exact prompt composition and integrity

- The new sections are appended only to the chained system prompt in `before_agent_start`; every pre-existing byte is preserved.
- The skills sanitization from e12s01 still applies; the compressed skill-name list is added in addition to (not instead of) the sanitizer's behavior.
- When the skills section is absent or multiple stanzas exist, the sanitizer remains a no-op and the new sections are still appended.

## 6. Failure modes

Missing tool summaries, duplicate or conflicting tool entries, MCP tools leaking into the summary list, suppressed/skill lists exceeding bounds, non-deterministic ordering, disclosure of schemas/bodies/paths/secrets, a tool becoming uncallable despite being listed, async-registered tools missing from the landscape, prompt-direct tools bypassing the registry, and prompt corruption from malformed XML.

## 7. Preconditions

- e12s01's router, finder tools, skills sanitizer, and permission wiring are already passing.
- Pi exposes `getAllTools`, `getActiveTools`, `setActiveTools`, `before_agent_start`, and `systemPromptOptions.skills` as documented.
- The machine-local Codex extension and the repo's mcp extension are the reference async/MCP registrants under test.

## 8. Inputs

Registered parent tool metadata (name, description, source), active tool names, loaded-skill metadata, the chained system prompt, session lifecycle events, and the async registration/prompt-direct behavior of MCP and Codex tools.

## 9. Outputs

A bounded system-prompt section with non-MCP tool summaries and compressed XML suppressed-tool/skill-name lists, unchanged callability for every non-MCP tool, and unchanged finder/permission behavior.

## 10. Quality attributes

Small but complete initial context, deterministic ordering, disclosure minimization, callability preservation, prompt integrity, async-registration safety, and MCP/Codex handling without duplication.

## 11. Interfaces and contracts

- `buildAvailabilityPrompt(tools, activeNames, skills)` — a pure projector returning the appended prompt section (non-MCP summaries + compressed XML suppressed/skill names); never returns a schema/body/path/policy/secret.
- The `before_agent_start` handler appends the section and returns the modified system prompt.
- `find_tools` and `find_skills` behavior is unchanged.

**Open design questions (resolved during planning/implementation, recorded here so later context windows do not re-derive them):**

- **DQ1 — Callability when `active=false`:** Pi sends only active tool schemas to the provider, so a non-active tool cannot be called. **DECISION (user): lazy activation** — a tool becomes active on its first call (option (c)). A tool that is listed in the prompt summaries is callable; the router activates it lazily when the model calls it, without a prior `find_tools` selection round-trip. Verify Pi's call-dispatch path accepts a call to a registered-but-inactive tool and triggers activation before execution.
- **DQ2 — MCP identification:** extension-registered tools carry `source: "local"` and MCP name prefixes vary. **DECISION (user): no identification needed.** Instead, the MCP extension must not auto-load its tools, or must load them as `active=false`, and lazy activation (DQ1) makes them callable on demand. The fix is in the MCP extension's registration/activation behavior, not in a router-side classifier.
- **DQ3 — Prompt-direct tools:** **DECISION (user): fix the machine-local Codex extension** to register through the router's registry (`pi.registerTool`/`getAllTools`) instead of adding itself to the prompt directly, so the router's landscape sees it exactly once.
- **DQ4 — Compressed XML shape:** **DECISION (user): undecided / flexible** — the exact element set is left to implementation; keep it bounded, deterministic, escaped, and free of descriptions/paths/bodies.

## 12. State

The router's in-memory session state (selected tools, cached skill metadata) is unchanged from e12s01. The new prompt sections are derived per `before_agent_start` from live registry/active/skill data and are not persisted.

## 13. Dependencies

- `[OK] @earendil-works/pi-coding-agent` — existing peer dependency (tool registry, active-tool APIs, skills prompt formatting).
- `[OK] extensions/context-router/` — e12s01 router, finders, sanitizer.
- `[OK] extensions/mcp/` and machine-local `codex-mcp.ts` — reference async/MCP registrants whose lifecycle is observed and, where needed, fixed.
- `[OK] extensions/tool-permissions/` — unchanged authorization boundary.

## 14. Failure modes

A listed tool is uncallable, an MCP tool leaks into the summary list, a prompt-direct tool is missed or duplicated, a suppressed/skill list exceeds bounds or leaks descriptions/paths, malformed XML corrupts the prompt, or the new sections reintroduce schemas/bodies/secrets into model context.

## 15. Observability

The existing count-only debug command may add counts for summarized tools, suppressed tools, and listed skills. No new raw catalog, skill text, policy, input, token, credential, or source path enters diagnostics.

## 16. Impact

Extends the e12 context-router's `before_agent_start` prompt composition, reverses the e12s01 `subagent_result` inactive-at-startup decision, adds MCP identification and async/Codex handling, and updates the router's tests. It must not change finder, permission, subagent, or mcp owned behavior.

## 17. Acceptance criteria

### Scenario: First turn shows the full non-MCP tool landscape

**Given** built-ins, `subagent`, `subagent_result`, MCP tools, and Codex tools are registered
**When** the first model turn's system prompt is composed
**Then** it contains a one-line summary for every registered non-MCP tool, no MCP tool summary, and no parameter schema or secret-shaped value.

### Scenario: Suppressed tools and skills are listed by name

**Given** inactive MCP/custom tools and loaded skills exist
**When** the system prompt is composed
**Then** a compressed XML list contains the names of suppressed tools and the names of skills, without descriptions, paths, or bodies.

### Scenario: A listed non-MCP tool is callable without activation

**Given** `subagent_result` is registered but not in the active set
**When** the model calls it directly
**Then** the call is accepted and executed without a prior `find_tools` selection.

### Scenario: MCP tools stay out of the summary list

**Given** an MCP tool is registered by a plugin
**When** the system prompt is composed
**Then** the MCP tool appears only in the suppressed-tool list and is not summarized as a non-MCP tool.

### Scenario: Async-registered tools appear exactly once

**Given** a Codex tool registers asynchronously after startup and also appears in the prompt
**When** the next turn boundary and prompt composition occur
**Then** the tool appears exactly once in the correct section and is not duplicated or missed.

### Scenario: Discovery and permissions are unchanged

**Given** the new prompt sections are present
**When** the model calls `find_tools` or `find_skills`
**Then** results are unchanged, permission behavior is unchanged, and an explicit `/skill:name` still expands through Pi.

## 18. Automated verification

- `node --test extensions/context-router/prompt.test.ts` (new availability-section tests)
- `node --test extensions/context-router/catalog.test.ts` (MCP identification, suppressed projection)
- `node --test extensions/context-router/index.test.ts` (callability, prompt composition, async handling)
- `node --test extensions/context-router/integration.test.ts` (Codex/prompt-direct handling)
- `npm run check`
- `"$BIGPOWERS_ROOT/scripts/lib/plan-consistency-check.sh" .specs/epics/e12-global-context-router`

## 19. Implementation steps

For every behavior, create a behavioral RED Jujutsu change before a separate GREEN implementation change. Missing exports, imports, modules, or functions are invalid RED evidence.

1. Add a pure availability-section projector: non-MCP tool summaries plus compressed XML suppressed-tool and skill-name lists, with bounds, deterministic ordering, escaping, and no schema/body/path/secret disclosure. → verify: `node --test extensions/context-router/prompt.test.ts`
2. Define MCP identification (DQ2) and project suppressed tools accordingly; prove MCP tools never enter the summary list. → verify: `node --test extensions/context-router/catalog.test.ts`
3. Integrate the section into `before_agent_start` while preserving e12s01 sanitizer behavior and prompt integrity. → verify: `node --test extensions/context-router/index.test.ts`
4. Make every non-MCP tool callable when not active (DQ1), proving `subagent_result` is callable from the start without a finder round-trip. → verify: `node --test extensions/context-router/index.test.ts`
5. Handle async-registered and prompt-direct tools (DQ3) so Codex/MCP tools appear exactly once in the correct section. → verify: `node --test extensions/context-router/integration.test.ts`
6. Update count-only diagnostics, docs, and run full regressions. → verify: `npm run check && "$BIGPOWERS_ROOT/scripts/lib/plan-consistency-check.sh" .specs/epics/e12-global-context-router`

## 20. Definition of done

Every parent session's system prompt lists summaries of all non-MCP tools and compressed XML names of suppressed tools and skills; every non-MCP tool is callable without a discovery round-trip (`subagent_result` included); MCP tools are never summarized and appear only as suppressed names; async/prompt-direct tools appear exactly once; and no new schema/body/path/policy/secret enters the prompt or discovery output.
