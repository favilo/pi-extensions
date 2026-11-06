# e07s01 — Parser Decision Record

## 1. Decision

**Selected parser: `unbash` (v4.0.10)**

`unbash` is a fast, zero-dependency Bash parser written in TypeScript. It provides
a rich AST with source positions (`pos`/`end`), word parts for quoting and
expansion, and structured node types for all major Bash syntax constructs.

## 2. Candidates evaluated

| Package | Version | Last Published | TypeScript | Deps | License | Verdict |
|---------|---------|----------------|------------|------|---------|---------|
| `unbash` | 4.0.10 | 2026-08-09 | Native | 0 | MIT | **Selected** — rich AST, source spans, 0 deps, actively maintained |
| `bash-ast` | 0.1.3 | 2026-08-13 | Yes | Unknown | Unknown | Not evaluated — newer but less mature ecosystem |
| `shell-quote` | 1.10.0 | 2026-07-10 | Yes | 0 | MIT | Tokenizer only — no full AST, no source spans for compound commands |
| `bash-parser` | 0.5.0 | 2017-06-22 | No | Many | MIT | **Rejected** — unmaintained (9 years), no TypeScript types |
| `@banyudu/bash-parser` | 0.6.0 | 2026-05-07 | No | Many | MIT | Fork of bash-parser — still no TypeScript types |

## 3. Syntax coverage

### Supported (subcommand extraction works)

- **Simple commands**: `jj status` → one subcommand
- **AndOr compounds**: `cmd1 && cmd2`, `cmd1 || cmd2` → two subcommands
- **Sequential**: `cmd1; cmd2` → two subcommands
- **Pipelines**: `cmd1 | cmd2` → two subcommands
- **Explicit `bash -c`**: `bash -c 'jj status; jj diff'` → payload parsed recursively
- **Quoted arguments**: `echo "hello world"` → argument boundaries preserved
- **Redirects**: `cmd > file.txt` → redirect stripped, subcommand preserved

### Unsupported (fail-closed)

- **Command substitution**: `$(cmd)`, backticks → `unsupported_syntax`
- **Process substitution**: `<(cmd)`, `>(cmd)` → `unsupported_syntax`
- **Arithmetic expansion**: `$((expr))` → `unsupported_syntax`
- **Parameter expansion**: `${var}` → `unsupported_syntax`
- **For loops**: `for f in ...; do ...; done` → `unsupported_syntax`
- **While/Until loops**: `while ...; do ...; done` → `unsupported_syntax`
- **If conditionals**: `if ...; then ...; fi` → `unsupported_syntax`
- **Functions**: `name() { ... }` → `unsupported_syntax`
- **Subshells**: `(cmd1; cmd2)` → `unsupported_syntax`
- **Brace groups**: `{ cmd1; cmd2; }` → `unsupported_syntax`
- **Case statements**: `case ... in ... esac` → `unsupported_syntax`
- **Coproc**: `coproc ...` → `unsupported_syntax`
- **Test commands**: `[[ ... ]]` → `unsupported_syntax`
- **Arithmetic commands**: `(( ... ))` → `unsupported_syntax`

## 4. Parser contract

### Types

```typescript
type ParsedSubcommand = {
  normalized: string;          // e.g., "jj status"
  span: { start: number; end: number };  // source positions in original text
  command: string;             // e.g., "jj"
  args: string[];              // e.g., ["status"]
};

type BashParseResult =
  | { ok: true; subcommands: ParsedSubcommand[] }
  | { ok: false; reason: "unsupported_syntax" | "parse_error"; detail: string };
```

### Source spans

`unbash` provides `pos` and `end` on every AST node. The `Command` node's `pos`/`end`
cover the full command text including redirects. Source spans are preserved
through `bash -c` recursion by offsetting inner spans by the payload word's
position in the outer source.

### Normalization

The `normalized` field uses `word.value` (unquoted) for the command and each
argument, joined by spaces. This matches the existing permission rule matching
contract where `input.command` is the raw command string.

### Fail-closed behavior

Any syntax type not explicitly handled in the `extractSubcommands` switch
returns `{ ok: false, reason: "unsupported_syntax", detail: "..." }`. This
ensures the permission boundary never auto-allows uncertain syntax.

## 5. Dependency assessment

- **`unbash`**: 0 dependencies, MIT license, TypeScript native, ~45KB minified
- **Bundle impact**: Minimal — no transitive dependencies
- **Failure behavior**: Non-throwing — parse errors are returned as `ParseError[]`
  on the `ParsedScript` object, not thrown

## 6. Recommendation

Use `unbash` as the Bash parser for e07s02 (subcommand decision boundary). The
AST provides everything needed: source spans for audit, word parts for
expansion detection, and structured node types for fail-closed classification.

For e07s02, the decision boundary should:
1. Call `parseBashCommand(command)` to get subcommands
2. Evaluate each subcommand's `normalized` against existing permission rules
3. If any subcommand is denied or requires ask, deny/ask the whole command
4. Use `span` to identify the denied subcommand in agent-facing messages
