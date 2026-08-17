# Impact Analysis — e12s01 Global context router

## Target

A new final-load-order package extension at `extensions/context-router/`, its package registration in `package.json`, and the existing runtime contracts it composes: Pi active-tool APIs, Pi's structured `before_agent_start` skill options, the generic custom-tool branch in `extensions/tool-permissions/index.ts`, MCP registration in `extensions/mcp/index.ts`, and parent-side `subagent` registration in `extensions/subagent/index.ts`.

## Dependents (8)

- `package.json`: defines package extension order; the router must load after `mcp`, `tool-permissions`, and `subagent` so it observes their registered tools and its two finder tools enter the existing policy path.
- `extensions/enable-extra-tools/index.ts`: presently adds `grep`, `find`, and `ls` at `session_start`; the router's baseline enforcement must preserve these three names without retaining other incidental active custom tools.
- `extensions/local-agent-context/index.ts`: also chains `before_agent_start` prompt changes; skill sanitization must operate on its received chained prompt and never reconstruct or overwrite unrelated prompt content.
- `extensions/mcp/index.ts`: can register and unregister provider tools after startup; a late registration is auto-activated by Pi and must be removed from the next model request unless selected.
- `extensions/mcp/index.test.ts` and `extensions/mcp/lifecycle.test.ts`: establish provider registration and active-tool cleanup behavior that must remain valid.
- `extensions/subagent/index.ts`: owns baseline `subagent` plus deferred `subagent_result`; the router must retain only the former at startup and must not change the child-only `subagent-tool-request` bridge catalog.
- `extensions/tool-permissions/index.ts`: its generic known-custom-tool path resolves configured allow/deny rules and fails closed without UI; the finder tools must enter this existing branch unchanged.
- `extensions/tool-permissions/index.test.ts`: supplies the current custom-tool policy harness and must gain finder-tool configured-allow, configured-deny, and headless-unmatched regression cases.

## Affected Stories

- `e03s01`–`e03s04`: remain the owners of scoped permission configuration and audit behavior; e12 consumes but must not modify their policy contract.
- `e06s02`–`e06s08`: remain the owners of child bridge authorization, lifecycle, and result retrieval; e12 must not route child-private catalogs or activate `subagent_result` at startup.
- `e12s01`: owns parent prompt/tool catalog reduction, discovery, exact skill-section sanitization, and safe diagnostics.

## Test Coverage

- `extensions/enable-extra-tools/index.test.ts`: covers additive session-start activation and is the closest baseline-active-set precedent.
- `extensions/mcp/index.test.ts` and `extensions/mcp/lifecycle.test.ts`: cover provider registration and removal but not a later global baseline reset.
- `extensions/local-agent-context/index.test.ts`: covers chained `before_agent_start` prompt modification but not canonical skill-section replacement.
- `extensions/tool-permissions/index.test.ts`: covers known custom tools, configured allow/deny, and headless denial, but not either finder tool.
- `extensions/subagent/index.test.ts`: covers parent subagent registration and deferred result lookup, but not its startup visibility under a context router.
- Gap: no current test exercises Pi's exact `formatSkillsForPrompt()` rendering, occurrence-safe prompt removal, deterministic redacted ranking, finder selection, session-selected tool retention, or late `registerTool()` reactivation.

## Risk: High

This is a global prompt and active-capability boundary. A faulty baseline reset can silently expose privileged custom/MCP tools; a discovery output or debug path can reintroduce schemas, skill bodies, policy data, or hostile metadata; and broad prompt replacement can remove unrelated instructions or break explicit skill invocations.

## Recommended action

Proceed in behavioral RED/GREEN slices. Isolate pure catalog projection and exact skills-stanza matching from Pi event wiring; reset only between turns; retain no schema, raw path, policy, input, token, or skill-body value in model-visible discovery/diagnostic output; and prove both finder tools still traverse `tool-permissions` with no configured-policy bypass.

## WSJF

Unscored backlog item. The user requested planning, but supplied no business-value, time-criticality, risk-reduction, or job-size scoring inputs; do not invent a priority score. Score e12 before scheduling implementation.
