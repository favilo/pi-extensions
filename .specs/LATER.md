# Later

Unfinished ideas. Add the next idea at the bottom. This file is a holding list,
not a plan, and it does not start work.

## Skip activate_skill after a recent /skill command

Block `activate_skill` when `/skill:<name>` already ran for that skill
recently. The slash command has already put the skill in context. Reading
`SKILL.md` again only repeats it.

The important case is when the skill files have not changed since that load. If
a file changed, loading it again can still be useful.

## Allow other tools forever

The permission prompt can save an allow rule into the project
`.pi/permissions.toml` or the user permissions file.

Known MCP tools already get that action. `handleUnknownToolPermission` passes
an empty `suggestedRule` for a known `mcp__` tool, and Ctrl+A / Ctrl+Shift+A
write it under that tool's own key. An empty allow rule matches every call.

Expose the same save for other tool types. I want to allow
`context-checkpoint`, and some skills, forever from the prompt, into either the
local or the user `permissions.toml`. Those tools already evaluate by their own
permission key. The prompt for a known non-MCP tool does not offer the save.

## A tool that proposes a permission rule

Add a tool that writes one permission rule for a case where a good regex is
hard to invent, such as `jj diff ...`. The tool shows the rule for audit.
Approval loads that rule into the permissions file the request names, project
or user.

This tool can never be allow-listed. Every call stays an explicit approval. An
allow rule for the tool itself must not match.

Also look at shipping a skill with the pi-extensions plugin. Loading that
skill should be enough to drive this permission edit.

## Configurable external edit tools with diff approval

Allow registered extension tools that perform exact-text edits to opt into the
same diff-based approval UI as Pi's built-in `edit` tool. The registration must
be configurable from a settings file, rather than hard-coding tool names in
tool-permissions.

A configured tool needs a way to resolve its request into: a stable display
path, the existing text, and its `edits[].oldText` / `edits[].newText` array.
The permission prompt must generate and display the complete contextual diff
before approval, then preserve the existing tool's execution path. Reject an
invalid resolver result or an edit whose preconditions fail before prompting.

Initial consumer: `obsidian_edit`, resolving its `vault` and `note` arguments
to the vault's note path. The mechanism should remain generic for other
extension edit tools. Keep the Rust/WASM permission migration in mind: put
policy/registration semantics behind the native boundary where appropriate,
while leaving host-specific filesystem resolution in the host adapter.

## Message another running Pi session

Add a tool for sending a message to an independently running Pi session, such
as an agent working in another project directory. Let the caller identify the
intended session and choose whether to steer an active turn or queue a
follow-up. Make the target and message visible for approval, and report whether
the message was accepted or the session was unavailable. Preserve session
isolation and avoid writing directly to another session's transcript.

## Parallel subagents with a navigable child-agent UI

Remove the single-active-child constraint so independent subagents can run in
parallel. Replace the current child display with a durable pane/tab UI: one tab
per child, keyboard navigation, live status/output, and a clear title-bar badge
when a child is waiting for permission.

Permission prompts should appear in the waiting child's tab/pane so the user
has direct execution context. The parent must still serialize or otherwise
safely coordinate approval decisions, route each result to the correct child,
and prevent ambiguous prompts. Define concurrency semantics for simultaneous
file edits, cancellation, completion notifications, background lifecycle
cleanup, and result export before implementation.

This is a major UX and concurrency redesign, not a simple limit increase.
Preserve per-child runtime isolation and the requirement that every child tool
action receives separate approval.

## Compress the permission prompt UI

The permission prompt is too verbose and uses too much vertical space.
Compress the layout and drop redundant fields so more of the decision and
request stay visible without scrolling.

