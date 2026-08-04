# Agent instructions

## Bigpowers script execution

Keep the working directory at the project root. Do **not** `cd` into the Bigpowers checkout to run its scripts.

`BIGPOWERS_ROOT` is provided by the environment and identifies the Bigpowers installation. Invoke Bigpowers scripts by absolute path while remaining in this project directory:

```bash
"$BIGPOWERS_ROOT/scripts/<script>.sh" ...
```

For project-local scripts, invoke them from the project root and preserve the existing environment:

```bash
BIGPOWERS_ROOT="$BIGPOWERS_ROOT" bash .github/scripts/check-active-plans.sh
```

Never use `cd "$BIGPOWERS_ROOT"` merely to run a Bigpowers script. The project root is the execution context; `BIGPOWERS_ROOT` is only the script location/configuration.

Do not add machine-local absolute paths to repository files. Use environment variables such as `${HOME}`, repository-relative paths, or descriptive fake paths in fixtures and verification evidence.

## TDD

RED results must prove a behavioral contract failure. `module_not_found`, missing exports, missing functions, import errors, and other harness/setup failures are not valid RED results. Before running the RED test, create the smallest stub implementation with the required public module and function names; the test must then fail because the stub returns the wrong behavior or violates the contract. Keep test-only RED and implementation GREEN in separate Jujutsu changes.
