# e15s02 UAT — Monitored Background Bash

Start a fresh session from the repository root:

```bash
cd ~/git/agent-skills/pi-extensions
pi
```

## 1. Verify default tools

Ask:

> What background Bash tools are available? List the active tools.

Confirm the active tools include:

```text
bash
bash_task
find_tools
find_skills
```

You can also run:

```text
/tools-debug
```

## 2. Background plus monitoring

Ask:

```
Run this command in the background with monitoring enabled:

`for i in 1 2 3; do echo "change-$i"; sleep 1; done`

Use `background: true` and `monitor: true`.
```

Expected launch row:

```text
background: true monitor: true
$ for i in...
```

Verify that the task ID is returned immediately, the agent wakes for each completed line, and a final completion notification arrives.

## 3. Background without monitoring

Ask:

```
Run this in the background without monitoring:

`for i in 1 2 3; do echo "silent-$i"; sleep 1; done`
```

Verify that the task starts immediately but produces no live output wakeups.

## 4. List tasks

Ask:

> List my background Bash tasks.

Expected call:

```json
{ "action": "list" }
```

## 5. Fetch bounded output

Ask:

> Fetch stdout for task `<task-id>`, starting at line 1, with a maximum of 2 lines.

Expected call:

```json
{
  "id": "<task-id>",
  "action": "output",
  "stream": "stdout",
  "offset": 1,
  "limit": 2
}
```

## 6. Monitor stderr

Ask:

```
Run this in the background with monitoring enabled:

`for i in 1 2; do echo "error-$i" >&2; sleep 1; done`
```

Verify notifications identify `stderr`.

## 7. Stop monitoring

Start the following with `background: true` and `monitor: true`:

```text
while true; do date; sleep 1; done
```

Then ask:

> Stop monitoring task `<task-id>`, but leave the process running.

Verify monitoring stops, the process remains running, and no further monitor notifications arrive.

## 8. Cancel the task

Ask:

> Cancel background task `<task-id>`.

Expected final status:

```text
cancelled
```

## 9. Verify discovery guidance

Ask:

> Find tools for inspecting background Bash tasks and activate any relevant tools.

`find_tools` should explain that `select` activates matching tools. `bash_task` should already be active by default.

Then ask:

> Find skills related to background tasks.

`find_skills` should explain that skills can be inspected with `read`, while tools are activated through `find_tools`.

## 10. Verify foreground Bash

Ask:

> Run `echo foreground` normally.

It should retain normal foreground behavior without background or monitor labels.

## 11. Verify output files

A background launch should include paths similar to:

```text
stdout: /tmp/pi-bg-bash/<session-id>/<task-id>-stdout.log
stderr: /tmp/pi-bg-bash/<session-id>/<task-id>-stderr.log
```

Inspect them externally with:

```bash
find /tmp/pi-bg-bash -type f -name 'bash-*.log'
```
