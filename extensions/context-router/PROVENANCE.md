# Provenance and Attribution

## Upstream Source

- **Project:** `SeanPedersen/pi-context-skills`
- **URL:** https://github.com/SeanPedersen/pi-context-skills/tree/5493713bcff23f29d00d113bc9d3c9294596b18a
- **Commit:** `5493713bcff23f29d00d113bc9d3c9294596b18a`
- **License:** MIT

## Adapted Concepts

The initial concept for stripping Pi's generated skills prompt section and exposing skill metadata for model discovery was adapted from `SeanPedersen/pi-context-skills`.

## Local Design Decisions

1. **Repository-Owned Extension:** Implemented as a repository-owned extension `extensions/context-router/` rather than an external dependency or standalone skill.
2. **On-Demand Tool & Skill Discovery:** Uses `find_tools` and `find_skills` custom tools to allow the model to discover and load tools and skills on demand.
3. **No Startup LLM Selection / No State Persistence:** Removed upstream's startup LLM selection pass and `.pi/skills-selection.json` file state.
4. **Exact-One Stanza Sanitization:** Replaces only exact single occurrences of `formatSkillsForPrompt(skills)` to ensure fail-safe system prompt modification without broad regex matching.
5. **Permission Continuity:** Enforces authorization through the existing generic `tool-permissions` boundary without policy bypasses or auto-allow overrides.
