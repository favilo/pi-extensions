# Agent instructions

## Bigpowers command guardrail — mandatory

This rule overrides convenience and applies to every agent, every task, and
every Bigpowers script, including timing, validation, setup, and verification
scripts.

Before executing any Bigpowers script:

1. Keep the working directory at the project root.
2. Invoke it only through its absolute installation path:
  `"$BIGPOWERS_ROOT/scripts/<script>.sh" ...`
3. Never invoke a Bigpowers script with a relative path such as:
  `bash scripts/<script>.sh`
  `./scripts/<script>.sh`
  `sh scripts/<script>.sh`
4. Never `cd` into `$BIGPOWERS_ROOT`.
5. If `BIGPOWERS_ROOT` is unset, stop and report the problem; do not guess the
   path.

Required form:

```bash
"$BIGPOWERS_ROOT/scripts/<script>.sh" ...
```

Before running a command, verify that any scripts/*.sh path belongs to the
project or to Bigpowers. If it belongs to Bigpowers, rewrite it using the
required absolute-path form.

## Version control

- `main` is protected: never push directly to it. Land every change through a
  `favilo/`-prefixed Jujutsu bookmark and a GitHub pull request.

## Rust

- Format Rust and TypeScript with `npm run fmt`. That runs `cargo fmt` for
  `extensions/tool-permissions/native` and Prettier for TypeScript.
- `npm test` and `npm run check` run `cargo test` for
  `extensions/tool-permissions/native`.
- Declare every dependency in `extensions/tool-permissions/native/Cargo.toml`
  under `[workspace.dependencies]`. Member crates use `dependency.workspace =
  true` and do not pin their own versions.
- Use strong types. Prefer enums, newtypes, and typestate over bare strings so
  an invalid value does not compile. A NAPI request may carry strings; convert
  those strings into domain types before doing any further work.
- Return `thiserror` enums from Rust. Do not use `String` or `&str` as an
  error type. Convert the typed error to the NAPI error only at the export
  boundary.

## TDD

RED results must prove a behavioral contract failure. `module_not_found`,
missing exports, missing functions, import errors, and other harness/setup
failures are not valid RED results. Before running the RED test, create the
smallest stub implementation with the required public module and function
names; the test must then fail because the stub returns the wrong behavior or
violates the contract. Keep test-only RED and implementation GREEN in separate
Jujutsu changes.
