# Agent instructions

## Bigpowers script execution

Keep the working directory at the project root. Do **not** `cd` into the Bigpowers checkout to run its scripts.

`BIGPOWERS_ROOT` is already provided by the environment and identifies the Bigpowers installation. Invoke Bigpowers scripts by absolute path while remaining in this project directory:

```bash
"$BIGPOWERS_ROOT/scripts/<script>.sh" ...
```

For project-local scripts, invoke them from the project root and preserve the existing environment:

```bash
BIGPOWERS_ROOT="$BIGPOWERS_ROOT" bash .github/scripts/check-active-plans.sh
```

Never use `cd "$BIGPOWERS_ROOT"` merely to run a Bigpowers script. The project root is the execution context; `BIGPOWERS_ROOT` is only the script location/configuration.

Do not add machine-local absolute paths to repository files. Use environment variables such as `${HOME}`, repository-relative paths, or descriptive fake paths in fixtures and verification evidence.
