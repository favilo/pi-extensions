# e12s01 — Route tool and skill catalogs through bounded discovery

## 1. Identity

- **Story:** e12s01
- **Type:** feature
- **Maturity:** 3 — Countable
- **BCPs:** 8
- **Risk:** P0
- **Delta:** ADDED
- **WSJF:** 5.4 = (business value 10 + time criticality 10 + risk reduction 7) / job size 5. User priority: smaller models are unusable without this bounded context router.

## 2. User need

Pi users with globally installed MCP providers and many skills need a capable but small initial model context. They must still be able to discover and deliberately load the precise parent capability or skill guidance needed for a task, without weakening existing permissions or child-runtime isolation.

## 3. Goal

Add a repository-owned, globally loaded `extensions/context-router/` extension that starts each parent session with exactly the approved baseline, offers permission-governed `find_tools` and `find_skills` discovery, removes only Pi's canonical generated skills catalog from the model prompt, and restores the intended active set before every model turn.

## 4. Non-goals

- Installing or depending on `SeanPedersen/pi-context-skills`.
- Patching Pi core or rewriting provider request payloads.
- Automatic skill selection, persisted selection files, or an LLM call during startup.
- Activating `subagent_result`, MCP tools, or other custom tools at startup.
- Changing permission-policy evaluation, auto-allow behavior, approval UX, or audit retention.
- Serializing tool parameter schemas, skill bodies, policies, tool inputs, tokens, or credential-shaped data into model-visible discovery/diagnostic output.
- Enumerating or changing the child-private `subagent-tool-request` bridge catalog.

## 5. Requirements

#### ADDED: Repository-owned extension and provenance

- Create `extensions/context-router/` with no new runtime dependency.
- Register `./extensions/context-router/index.ts` last in `package.json`'s explicit Pi extension list.
- Migrate/adapt only relevant concepts from `SeanPedersen/pi-context-skills` commit `5493713bcff23f29d00d113bc9d3c9294596b18a`; record the upstream URL, commit, MIT license, and locally changed design decisions in a repository-owned attribution document.
- Use Pi 0.82.1's documented `getAllTools`, `getActiveTools`, `setActiveTools`, `session_start`, `turn_start`, `before_agent_start`, `systemPromptOptions.skills`, and `formatSkillsForPrompt` boundaries only.

#### ADDED: Exact initial tool baseline and session selection

- At `session_start` and before every `turn_start`, make the parent active set the registered-name intersection of this exact baseline: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`, `subagent`, `find_tools`, and `find_skills`, plus names explicitly selected in the current parent session.
- Retain only registered selected names; discard selections when a provider unregisters their tool.
- Keep `subagent_result`, MCP tools, every other custom tool, and any late registration inactive unless selected.
- Do not reset the active set during a finder execution. `find_tools` must use an additive `setActiveTools([...active, ...selected])` call so Pi may expose newly selected registered definitions at that result's normal deferred-loading boundary.
- Clear all extension-local selections and cached skill metadata at `session_shutdown` and do not transfer them to a replacement session.

#### ADDED: Safe deterministic tool discovery

- Register `find_tools` as a normal custom tool that accepts a bounded query and an optional bounded list of names selected from its current matches.
- Search parent `pi.getAllTools()` records by normalized name, description, and redacted source category; rank by deterministic score and stable name tie-breaker.
- Return a bounded projection containing only normalized name, bounded description, redacted source category, active state, and selected/added state. Never return `parameters`, raw source paths, prompt guidelines, policy values, tool inputs, tokens, or credentials.
- Reject activation requests for names that are not registered current search matches. Activation changes only model tool visibility; it neither executes a selected tool nor bypasses that tool's normal `tool-permissions` evaluation.
- Normalize control characters and bound all returned fields and result counts.

#### ADDED: Safe on-demand skill discovery

- Capture the structured `systemPromptOptions.skills` metadata for the current parent session during `before_agent_start`; do not repeat filesystem discovery.
- Register `find_skills` as a normal custom tool that returns deterministic bounded matches with only a skill name, bounded description, and its SKILL.md path, instructing the model to use the existing `read` tool for a selected path.
- Never return a SKILL.md body, a generated skills catalog, or raw provenance fields through finder or diagnostic results.
- Do not register an `input` handler or otherwise intercept `/skill:name`; Pi's normal input-expansion path remains authoritative.

#### ADDED: Exact skills-prompt sanitization

- Render the source section with `formatSkillsForPrompt(event.systemPromptOptions.skills)` and the replacement with `formatSkillsForPrompt([])`.
- Replace the source section only when that exact rendering occurs once in the received chained `event.systemPrompt`.
- When the rendering occurs zero times or more than once, return the prompt unchanged and retain only a safe enum/count sanitizer outcome for diagnostics.
- Preserve every non-skill byte of the chained system prompt, including prior extension and local-context content. Do not reconstruct the prompt with a broad regular expression.

#### ADDED: Existing generic custom-tool permission behavior

- `find_tools` and `find_skills` must reach `extensions/tool-permissions/index.ts` through its existing generic known-custom-tool branch.
- Configured allow executes the finder without a prompt; configured deny wins without a prompt; an unmatched call with no UI denies. No e12-specific policy branch or implicit finder allow is permitted.
- Tool selection never alters the later selected tool's policy evaluation.

#### ADDED: Count-only diagnostics

- Add a context-router debug command that reports only registered/active/selected tool counts, loaded-skill count, skills-section input/output byte counts, byte delta, and a sanitizer outcome enum.
- Do not list catalog entries or render schemas, descriptions, skill bodies, paths, policies, inputs, tokens, or credentials in diagnostic output.

## 6. Failure modes

Empty or malformed finder queries, no results, selection of stale/unmatched/unregistered names, late registration, provider unregistration, Pi API errors, zero/multiple canonical skills-section occurrences, unavailable skill metadata, configured deny, headless unmatched invocation, session reload, and shutdown.

## 7. Preconditions

- Pi 0.82.1 exposes the documented dynamic tool loading and `before_agent_start` structured prompt APIs.
- `tool-permissions` is loaded before the router and retains its generic custom-tool policy branch.
- `mcp` and `subagent` register parent tools before the final-loaded router derives its baseline.
- The upstream source's MIT provenance is recorded before adapted source is introduced.

## 8. Inputs

Registered parent tool metadata, active tool names, normalized finder query, optional matched tool selections, current structured loaded-skill metadata, chained system prompt, session lifecycle events, configured permission policy, UI availability, and session shutdown.

## 9. Outputs

A bounded active parent tool set, bounded redacted tool/skill discovery results, a safely sanitized initial system prompt when one canonical skills section exists, and count-only diagnostic output.

## 10. Quality attributes

Small initial context, deterministic discovery, deferred additive tool loading, parent-session isolation, prompt integrity, permission continuity, disclosure minimization, and safe late-registration handling.

## 11. Interfaces and contracts

- `find_tools({ query, select? })` returns a bounded redacted match list and activates only registered names supplied in `select` that occur in that result; it uses Pi's additive active-tool API and never returns a schema.
- `find_skills({ query })` returns bounded name/description/SKILL.md-path records and tells the model to use `read`; it does not invoke a skill or return its body.
- The active parent set is recomputed from baseline plus session-selected registered names at lifecycle boundaries. **Reason for Depth:** Pi can auto-activate late registrations, so one session coordinator must make the authorization-relevant next-turn surface deterministic without removing tools in a finder call.
- A pure metadata projector owns normalization, bounds, redaction, and ranking. **Reason for Depth:** one narrow boundary prevents future renderer/debug changes from accidentally traversing or serializing parameter schemas.
- A pure canonical-stanza sanitizer owns exact-one prompt replacement. **Reason for Depth:** prompt integrity requires a testable no-op failure behavior rather than duplicated ad hoc substring replacement.
- Existing `tool-permissions` remains the finder authorization interface; no new permission interface is introduced.

## 12. State

Selected parent tool names and structured skill metadata are in-memory and scoped to the live extension/session instance. They are cleared on `session_shutdown`; no selection file, cache, or session persistence is added.

## 13. Dependencies

- `[OK] @earendil-works/pi-coding-agent` — existing peer dependency supplying dynamic active-tool APIs and skills prompt formatting.
- `[OK] typebox` — existing peer dependency for strict finder input schemas.
- `[OK] extensions/tool-permissions/` — existing generic authorization boundary.
- `[OK] extensions/mcp/` and `extensions/subagent/` — existing parent registrations whose lifecycle is observed but not changed.
- `[OK] SeanPedersen/pi-context-skills` source snapshot — migration reference only; it is not a package/runtime dependency.

## 14. Failure modes

A late registration becomes visible without selection, a finder output includes a schema/body/secret, a selected name is not a current match, a stale selection survives session replacement, a malformed prompt replacement deletes unrelated context, explicit skill syntax is intercepted, or finder execution bypasses configured/custom-tool policy.

## 15. Observability

The debug command may expose only counts, sanitizer outcome, and prompt byte measurements. Finder results use bounded redacted records. No raw catalog, skill text, policy, input, token, credential, or source path enters logs, result details, or diagnostics.

## 16. Impact

This story adds one final-load-order global extension and its tests, updates package registration, and adds finder-specific coverage to the existing generic permission test harness. It is coupled to MCP late-registration lifecycle, subagent startup visibility, and chained prompt composition, but it must not change their owned behavior.

## 17. Acceptance criteria

### Scenario: First parent turn is restricted to the baseline

**Given** Pi has built-ins, `subagent`, `subagent_result`, and registered MCP/custom tools
**When** the context-router session starts and the first model turn begins
**Then** only the registered baseline names are active, and neither `subagent_result` nor an MCP/custom tool is model-callable.

### Scenario: A finder adds only a deliberate current match

**Given** an inactive registered MCP/custom tool matches a `find_tools` query
**When** the model passes that returned name in `select`
**Then** the finder adds that one name additively, returns no parameter schema, and the selected tool's definition is available for the next response; a stale or nonmatching name is not activated.

### Scenario: Late registration is not retained accidentally

**Given** an MCP/custom tool registers after startup and Pi temporarily adds it to the active set
**When** the next `turn_start` occurs without a finder selection
**Then** the router removes that unselected name before the model request while retaining every still-registered selected name.

### Scenario: Skill catalog is removed only at the canonical seam

**Given** the chained system prompt contains one rendering from `formatSkillsForPrompt(loadedSkills)`
**When** `before_agent_start` runs
**Then** only that rendering is replaced by `formatSkillsForPrompt([])` and every surrounding byte remains unchanged; zero or more-than-one occurrences leave the complete prompt unchanged.

### Scenario: Skills stay discoverable and explicit invocation works

**Given** structured loaded skill metadata includes a matching skill
**When** the model calls `find_skills`
**Then** it receives a bounded name, description, and SKILL.md path and can use `read` for that path; an explicit `/skill:name` follows Pi's normal expansion path without router interception.

### Scenario: Finder policy is unchanged

**Given** `find_tools` or `find_skills` has a configured allow, a configured deny, or no matching rule in a headless session
**When** the finder is called
**Then** the existing generic custom-tool policy respectively allows without prompting, denies with deny precedence, or denies because UI is unavailable.

### Scenario: Diagnostics are count-only

**Given** registered tools and loaded skills include long descriptions, schemas, local paths, or secret-shaped values
**When** the context-router debug command runs
**Then** it reports only permitted counts, byte measurements, and sanitizer outcome and exposes none of those source values.

## 18. Automated verification

- `node --test extensions/context-router/catalog.test.ts`
- `node --test extensions/context-router/index.test.ts extensions/context-router/prompt.test.ts`
- `node --test extensions/tool-permissions/index.test.ts extensions/context-router/index.test.ts`
- `npm run check`
- `"$BIGPOWERS_ROOT/scripts/lib/plan-consistency-check.sh" .specs/epics/e12-global-context-router`

## 19. Implementation steps

For every behavior, create a behavioral RED Jujutsu change before a separate GREEN implementation change. Missing exports, imports, modules, or functions are invalid RED evidence.

1. Add safe pure projections for registered parent tools and structured loaded skills: deterministic scoring, stable tie ordering, control-character normalization, count/field bounds, source redaction, and no-schema/body disclosure. → verify: `node --test extensions/context-router/catalog.test.ts`
2. Register both finder tools and implement session-scoped baseline/selection coordination at startup, finder execution, turn start, unregister, and shutdown. → verify: `node --test extensions/context-router/index.test.ts`
3. Implement exact-one canonical skills-section replacement from structured `systemPromptOptions.skills`, retain only safe metadata for `find_skills`, and prove no input interception changes explicit skill expansion. → verify: `node --test extensions/context-router/prompt.test.ts`
4. Add configured allow, configured deny, and headless-unmatched finder cases to the existing generic custom-tool permission harness without adding a special policy path. → verify: `node --test extensions/tool-permissions/index.test.ts extensions/context-router/index.test.ts`
5. Add MIT provenance, count-only debug diagnostics, final package order, focused integration tests, and documentation; then run full regressions. → verify: `npm run check && "$BIGPOWERS_ROOT/scripts/lib/plan-consistency-check.sh" .specs/epics/e12-global-context-router`

## 20. Definition of done

Every new parent session begins with only the defined registered baseline, tools and skills are discoverable through bounded permission-governed routes, unselected late tools never reach the next model request, Pi's generated skill catalog is removed only at its exact canonical rendering, and no discovery or diagnostic path reintroduces schemas, bodies, policies, inputs, or secret-shaped data into model context.
