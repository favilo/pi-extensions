# Agent instructions

## Bigpowers command guardrail — mandatory

This rule overrides convenience and applies to every agent, every task, and every
Bigpowers script, including timing, validation, setup, and verification scripts.

Before executing any Bigpowers script:

1. Keep the working directory at the project root.
2. Invoke it only through its absolute installation path:
  `"$BIGPOWERS_ROOT/scripts/<script>.sh" ...`
3. Never invoke a Bigpowers script with a relative path such as:
  `bash scripts/<script>.sh`
  `./scripts/<script>.sh`
  `sh scripts/<script>.sh`
4. Never `cd` into `$BIGPOWERS_ROOT`.
5. If `BIGPOWERS_ROOT` is unset, stop and report the problem; do not guess the path.

Required form:

```bash
"$BIGPOWERS_ROOT/scripts/<script>.sh" ...
```

Before running a command, verify that any scripts/*.sh path belongs to the
project or to Bigpowers. If it belongs to Bigpowers, rewrite it using the
required absolute-path form.

## TDD

RED results must prove a behavioral contract failure. `module_not_found`, missing exports, missing functions, import errors, and other harness/setup failures are not valid RED results. Before running the RED test, create the smallest stub implementation with the required public module and function names; the test must then fail because the stub returns the wrong behavior or violates the contract. Keep test-only RED and implementation GREEN in separate Jujutsu changes.
