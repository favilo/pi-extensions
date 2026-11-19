# Story e19s02: Validate prompt queue FunctionRef lifetime under Miri

## 1. Business narrative

Before Rust callbacks use prompt serialization, maintainers need evidence that the prompt queue's function-reference lifetime strategy is sound.

## 2. Actors

- Tool-permissions Rust runtime
- Maintainer running Miri

## 3. Problem

The prompt queue has a FunctionRef lifetime-erasure pattern inherited from e18 planning but lacks Miri evidence before it is copied into Rust-owned callback orchestration.

## 4. Outcome

The prompt queue lifetime contract is isolated, documented, and passes Miri for the supported ownership pattern.

## 5. Happy path

A prompt callback is borrowed only for its active invocation, the queue settles its response, and Miri completes without undefined-behavior findings.

## 6. Alternative flows

- Cancellation resolves as denial and releases transient state.
- A prompt callback failure resolves fail-closed.

## 7. Scope

The prompt queue FunctionRef lifetime mechanism and Miri validation moved from cancelled e18s07.

## 8. Non-goals

Migrating all prompt UI behavior or broad callback registration.

## 9. Dependencies

- e19s01 safe callback boundary.
- Rust Miri toolchain [OK: Rust project tooling].

## 10. Assumptions

The tested queue path can be exercised with Rust-only state under Miri even if NAPI host integration itself is outside Miri coverage.

## 11. Data model

Prompt identity, pending queue state, owned decision result, and invocation-scoped function reference.

## 12. Interfaces

A pure or isolated queue interface accepts a prompt operation and returns a settled decision without retaining borrowed host values.

**Reason for Depth:** The queue hides ordering, cancellation, and lifetime rules behind a single owned-decision interface.

## 13. Security and safety

Cancellation and host errors deny by default. No unsafe lifetime extension is permitted.

## 14. Observability

Miri output and the focused queue test identify the validated ownership contract.

## 15. Compatibility

Preserve current prompt ordering and denial-on-cancel behavior.

## 16. Requirements

#### ADDED: Miri-validated prompt queue lifetime

The Rust prompt queue lifetime pattern must pass Miri before migrated callbacks depend on it.

## 17. Acceptance criteria

```gherkin
Scenario: Prompt queue lifetime passes Miri
  Given the supported prompt queue ownership scenario
  When the focused Miri test runs
  Then it passes without undefined-behavior findings

Scenario: Cancelled prompt fails closed
  Given a queued permission prompt
  When its session cancels
  Then the queue resolves it as denial
  And releases pending state
```

## 18. Out of scope

NAPI callback host integration and UI parity migration.

## 19. Risks

Miri may expose an unsound abstraction that needs redesign before production migration.

## 20. Implementation steps

1. Move the e18s07 prompt-queue lifetime scenario and assumptions into the e19 test boundary → verify: `cargo miri test -p tool-permissions-native prompt_queue`
1. Correct safe ownership until the focused Miri scenario passes → verify: `cargo miri test -p tool-permissions-native prompt_queue`

## Verification script

1. Install the configured Miri component if absent.
1. Run the focused cargo Miri command from `extensions/tool-permissions/native`.
1. Confirm cancellation is denied and no Miri violation is reported.
