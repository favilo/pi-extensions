# Threat model — e18 WASM-only tool-permissions runtime

## Scope

This threat model covers moving the remaining tool-permissions host areas into the existing NAPI WASM runtime and then removing the TypeScript fallback. It extends e16. It does not reopen the e16 hybrid boundary.

## Assets and trust boundaries

| Asset | Why it matters |
| --- | --- |
| Permission decisions | A wrong allow can run model-authored tool input. |
| Canonical paths, trust, and `.aiignore` | A bad path check can honor a project policy outside its trust root or ignore a blocked path. |
| `permissions.toml` | A bad patch can persist a broader allow than the user approved. |
| Audit log | Review depends on one accurate record per decision, without policy secrets. |
| Prompt and steering state | Queue mixups can apply one approval to a different tool call. |
| Tool execution | An allow must execute once. A deny must not execute. |
| WASM artifact | After e18s06, a missing artifact must not fall back to another implementation. |

## Threats

1. **Silent allow on bad WASM output** — decode, version, or panic results are treated as success.
2. **Double ownership** — TypeScript and WASM both write the audit log, patch `permissions.toml`, or execute the tool.
3. **Trust escape** — canonicalization or `.aiignore` checks use a different root than the current host.
4. **Save/allow coupling** — a failed patch still allows the tool call or reports that the rule was saved.
5. **Queue mixup** — steering text or an approval is applied to the wrong queued prompt.
6. **WASM gains a shell or network** — the module executes tools by spawning processes itself instead of calling Pi.
7. **Fallback left behind** — after e18s06, a load failure still authorizes through TypeScript.

## Required mitigations

- Validate every WASM result before use. Invalid results deny the request.
- One owner writes each audit record, patches each rule, and executes each allowed tool call.
- Path, trust, and `.aiignore` parity tests use the current TypeScript results as the oracle until that path is removed.
- A failed save returns a failure and does not allow the call.
- Prompt queue tests bind steering and decisions to a tool-call id.
- Tool execution is a Pi host callback. The WASM module does not spawn a shell or open a network.
- e18s06 tests a missing and an invalid artifact and assert that no TypeScript engine authorizes the call.
- Keep the NAPI target on `wasm32-wasip1-threads`.

## Out of scope

- Changing user-visible allow, deny, prompt, or audit-field semantics.
- Sandboxing Pi itself.
- Porting other extensions.
