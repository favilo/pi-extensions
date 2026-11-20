---
status: in-progress
severity: medium
scope: built-in-tool-renderer
---

# Multiline validation details hidden

## Problem and diagnosis

Edit and write errors can include validation details on later lines. The renderer currently displays only the first line, hiding the reason while the agent receives it. Security impact: low; no exploit path identified.

## TDD plan

1. RED: exercise the registered edit and write renderers with a multiline validation failure and assert the missing-field detail appears. GREEN: preserve the full error text in the shared renderer helper. Verify: `npx tsx --test extensions/built-in-tool-renderer/edit-result.test.ts extensions/built-in-tool-renderer/result.test.ts`.
2. Run `npm run check` and ask the user to repeat the manual validation test.
