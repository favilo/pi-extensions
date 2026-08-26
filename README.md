# pi-extensions

Personal extensions for the [Pi coding agent](https://pi.dev).

## Install

For active development, install the local checkout. Pi references it directly, so changes become available after `/reload`:

```bash
pi install ~/git/agent-skills/pi-extensions
```

Install directly from GitHub:

```bash
pi install git:github.com/favilo/pi-extensions
```

Update a GitHub installation with:

```bash
pi update git:github.com/favilo/pi-extensions
```

Use `pi config` to enable or disable individual extensions.

### Required account-switcher dependency

The `subagent` account/model runtime requires the [`favilo/pi-account-switcher`](https://github.com/favilo/pi-account-switcher) fork to be installed and enabled in the same Pi process. It publishes the redacted child-runtime selection capability used to select an isolated OAuth account; without it, subagents retain Pi's default runtime.

Install the forked package alongside this extension, then reload Pi:

```bash
pi install git:github.com/favilo/pi-account-switcher
pi install git:github.com/favilo/pi-extensions
```

For active development, install the local checkout of the same fork instead. The fork must remain the configured package; do not substitute a stale package-manager cache for it.

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
| `mcp` | Registers independent MCP tool providers and reports their status through `/mcp`. |
| `tool-permissions` | Applies configurable allow and deny rules to tool calls. |

`jj-status` requires `jj` on `PATH` when used in a Jujutsu repository.

## Tool permissions

Permission rules and audit entries are stored locally and are not part of this repository:

- Rules: `~/.pi/agent/permissions.toml`
- Audit log: `~/.pi/tool-permissions/audit.log` (a symlink to the current UTC-dated log; the legacy `~/.config/pi/audit.log` is migrated on first write, and logs older than seven days are removed)

Run `/permissions` or `/permissions user` in Pi to edit the user rules. Run `/permissions local` to edit the current trusted project's rules. Permission prompts use Ctrl+A to save a project-scoped rule and Ctrl+Shift+A to save a user-scoped rule. When Pi has a persisted trust decision for the current project, trusted `.pi/permissions.toml` files are also discovered from the current directory up to the nearest Git or Jujutsu repository boundary. The nearest matching project rule overrides user policy; missing or unreadable trust data leaves user policy unchanged.

### Multiline steering & Vim keybindings

Permission prompts support Vim modal editing (`[INSERT]` / `[NORMAL]` modes) and custom editor extensions (such as `pi-vim-mode`).

To configure `Enter` to insert newlines in prompts and use explicit shortcuts (such as `Ctrl+Y` or `Ctrl+S`) for submission, add the following to `~/.pi/agent/keybindings.json`:

```json
{
  "tui.editor.yank": [],
  "tui.input.newLine": ["enter", "shift+enter", "ctrl+j"],
  "tui.input.submit": ["ctrl+s", "ctrl+y"]
}
```

- **`Enter`**: Inserts a new line into the prompt editor buffer for multiline steering.
- **`Ctrl+Y` / `Ctrl+S`**: Submits the prompt or permission steering decision.
- **`tui.editor.yank`: `[]`**: Unbinds `Ctrl+Y` from default kill-ring yank so it can be used as a submit shortcut.

## Development

```bash
npm install
npm run check
```

Each extension owns its implementation and tests under `extensions/<name>/`. Only the explicit `index.ts` files in `package.json` are loaded by Pi.

To create a machine-local MCP provider, see [`extensions/mcp/README.md`](extensions/mcp/README.md) and the self-contained [`examples/mcp-provider/`](examples/mcp-provider/) extension.

## Local-only integrations

Environment-specific MCP integrations remain machine-local and are intentionally excluded from this repository.
