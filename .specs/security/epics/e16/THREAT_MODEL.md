# Threat model — e16 Rust/WASM core migration for tool-permissions

## Scope
This threat model covers the planned hybrid migration of `extensions/tool-permissions/` Bash parsing and Bash authorization logic behind a Rust/WASM module boundary with a TypeScript host adapter.

## Assets and trust boundaries

| Asset | Why it matters |
| --- | --- |
| Permission decisions | A wrong allow can execute model-authored shell text. |
| Denied-subcommand detail | Users need truthful explanations without leaking unrelated policy. |
| Audit evidence | Security review depends on accurate per-command decision records. |
| Packaged WASM artifact | A missing or mismatched artifact can change runtime behavior. |
| Host/module contract | Decode or version drift can silently widen access unless it fails closed. |

## Threats
1. **Silent allow on bad module output** — invalid decode, shape drift, or partial results are treated as success.
2. **Fallback bypass drift** — the Rust/WASM path and TypeScript fallback produce different decisions for the same input.
3. **Parser/evaluator disagreement** — extracted subcommands and decision logic no longer share the same assumptions.
4. **Artifact omission or mismatch** — packaged installs load the wrong artifact or no artifact while claiming the Rust path is active.
5. **Resource exhaustion** — adversarial shell text triggers unbounded CPU, recursion, or memory growth inside the module.
6. **Expanded module capability** — the Rust/WASM module gains direct shell, filesystem, or network access beyond pure computation.

## Required mitigations
- The TypeScript host owns runtime selection and validates every module result against a versioned schema.
- Any load, init, decode, version, or runtime error fails closed to denial or to the existing TypeScript path, never to silent allow.
- The Rust/WASM core remains pure computation over validated inputs; prompt UI, audit writes, policy persistence, shell execution, and filesystem mutation stay in TypeScript.
- Parity suites compare Rust/WASM and TypeScript behavior over a shared corpus before removing old code paths.
- The package build and install flow verifies artifact presence and the active engine truthfully.
- Input and output sizes remain bounded, and recursion/complexity limits are explicit.

## Out of scope
- Replacing non-Bash tool families with Rust/WASM in this epic.
- Treating project trust or package trust as a sandbox.
- General Rust rewrite of unrelated extensions.
