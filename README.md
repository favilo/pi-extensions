# pi-extensions

Personal extensions for the [Pi coding agent](https://pi.dev).

## Install

This is a private GitHub repository. Authenticate GitHub access on the target computer, then run:

```bash
pi install git:github.com/favilo/pi-extensions
```

Update the package with:

```bash
pi update git:github.com/favilo/pi-extensions
```

Use `pi config` to enable or disable individual extensions.

## Extensions

| Extension | Purpose |
| --- | --- |
| `built-in-tool-renderer` | Provides compact custom rendering for Pi's built-in tools. |
| `clear-reload` | Adds `/clear` to start a fresh session and reload resources. |
| `enable-extra-tools` | Activates `grep`, `find`, and `ls`, and adds `/tools-debug`. |
| `exit` | Adds `/exit` as an alias for quitting Pi. |
| `focus-aware-cursor` | Keeps terminal cursor visibility synchronized with terminal focus. |
| `jj-status` | Shows the active Jujutsu bookmark or change ID instead of `detached`. |
| `local-agent-context` | Loads `AGENTS.local.md` and `AGENTS.override.md` into the system prompt. |
| `tool-permissions` | Applies configurable allow and deny rules to tool calls. |

`jj-status` requires `jj` on `PATH` when used in a Jujutsu repository.

## Tool permissions

Permission rules and audit entries are stored locally and are not part of this repository:

- Rules: `~/.config/pi/config.toml`
- Audit log: `~/.config/pi/audit.log`

Run `/permissions` in Pi to edit the rules.

## Development

```bash
npm install
npm run check
```

Each extension owns its implementation and tests under `extensions/<name>/`. Only the explicit `index.ts` files in `package.json` are loaded by Pi.

## Private extensions

Work-specific Codex MCP integration remains machine-local and is intentionally excluded from this repository.
