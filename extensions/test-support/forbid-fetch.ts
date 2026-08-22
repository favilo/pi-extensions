// Test hermeticity guard: unit tests must not make network calls.
// Every *.test.ts file must import this module (enforced by
// .github/scripts/check-test-guard.sh in check:ci), so the guard is active
// for any invocation — npm scripts, bare `node --test`, or single-file runs.
//
// A test that genuinely needs fetch (should be none) must save and restore
// globalThis.fetch within its own file — an explicit, reviewable opt-out.
globalThis.fetch = () => {
  throw new Error(
    "fetch() is forbidden in unit tests. Mock the boundary or inject the dependency instead.",
  );
};
