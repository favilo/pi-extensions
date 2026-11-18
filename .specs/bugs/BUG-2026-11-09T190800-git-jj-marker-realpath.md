---
bug_id: BUG-2026-11-09T190800
status: open
severity: medium
priority: medium
scope: tool-permissions-path-trust
title: WASM misses a repository boundary when .git or .jj cannot be canonicalized
---

# BUG-2026-11-09T190800: WASM misses a repository boundary when .git or .jj cannot be canonicalized

## Problem

The TypeScript project-policy walk treats `.git` or `.jj` as a repository boundary when `existsSync` succeeds. The WASM path-trust walk treats that marker as a boundary only when `realpath` succeeds.

When the marker exists but cannot be canonicalized, the two walks disagree:

- TypeScript still includes ancestor directories up to that marker and can apply a parent project rule.
- WASM reads only the current directory's `.pi/permissions.toml`.
- An inside-project read can then be allowed by WASM when the parent project rule would deny it.

## Expected

A `.git` or `.jj` marker that exists is the repository boundary even when `realpath` fails. Parent project rules inside that boundary stay in effect. A marker that does not exist does not extend the walk.

## Notes

This is deferred. The current path-trust change does not alter the marker check. Do not treat an unreadable marker as permission to skip parent policy.

## Verify

`cargo test --manifest-path extensions/tool-permissions/native/Cargo.toml`
