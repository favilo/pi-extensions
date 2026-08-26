# Discovered issues

Add newly discovered issues as unchecked numbered items. Once an issue has an epic/story destination, check it and add a `Migrated to` line; keep migrated entries here for provenance.

1. [x] The `edit` tool, when the oldText wasn't found, or matches more than one line, currently reports `Applied` and I have to manually type out steering text to indicate the failure.
   - This should return `Failed` to the agent, along with the reason for the failure. It shouldn't show the user the permissions dialog, since the failure is already deterministically known.
   - This should prompt the agent to retry the edit, ideally while rereading the original file so it can update `oldText` correctly.
   - **Migrated to:** `e11s01` — Return deterministic edit failures to the agent before permission prompts.

2. [x] The `bash` tool doesn't print the _whole_ Bash command in the history. I would like the `Ctrl+O` keybinding to print the entire formatted command, along with the output of the command.
   - **Migrated to:** `e11s03` — Show complete Bash commands and output in expanded history.

3. [x] Denied `edit` tool uses currently report `Applied` to the agent. They need to return `Denied` to the agent along with the reason for the denial, if the user provided one with the `<Tab>` keybinding. The history renderer must reflect that same agent-facing result, not manufacture a presentation-only denial.
   - **Migrated to:** `e11s02` — Return denied edit outcomes and reasons to the agent.

4. [x] The steering text from the `<Tab>` keybinding in the permissions tool should report the actual command that has steering text applied to it, so the agent doesn't misinterpret the steering text as applying to another parallel command.
   - **Migrated to:** `e09s01` — Identify the exact tool invocation receiving steering feedback.

5. [x] The `<Tab>` steering editor would be nice if it also supported Vim mode, like the normal prompt editor, rather than only accepting a single line without advanced editing capabilities.
   - **Migrated to:** `e10s01` and `e10s02` — Spike editor reuse, then support configured Vim editing in permission steering.

6. [x] The `edit` and `write` prompts currently crop the output to a certain number of lines. I don't like that. I would rather review _all_ of the lines, and then accept or deny based on the whole diff.
   - **Migrated to:** `e13s01` — Review complete edit and write diffs before approval.

7. [x] Let's add an `ast-grep` tool as an extension, so we can have the agents search code much more quickly. The ast-grep skill will probably need to be used by the agent. It can use the same permissions as `read`, `grep`, `ls` and `find` that we have already for current working directory and subdirectories.
   - **Migrated to:** `e14s01` — Add ast-grep structural search tool extension.

8. [x] I need the tool rendering to have the `reason` behind the tool use displayed both in history, and in the permission prompt. If that isn't available, I'd like the tool calls to have a `reason` field that is passed to the permission prompt, so the user can see why the agent is requesting the tool. This is especially important for tools like `edit` and `bash`, where the agent may be requesting an edit for a specific reason, and the user needs to understand that reason in order to make an informed decision about whether to allow or deny the request.
   - **Migrated to:** `e11s04` — Show tool-call reasons in permission prompts and history.

9. [ ] Add a scratchpad directory that is automatically approved for reads and writes, it is only per session, or possibly per folder that the agent is working in. This would allow the agent to have a place to write temporary files without needing to ask for permission every time. I want the scratchpad to work as a kind of audit log for the agent as well as a place to write temp files easily.

10. [ ] I would like to be able to autoload diffs from the AGENT.md file into the context so that when I've changed something, other agents are able to see the changes and use the new information
