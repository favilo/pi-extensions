# e15s01 — Run permission-enforced Bash commands in the background

## User need
Agents need to start long-running shell work without blocking the foreground conversation, in the same way Claude Agent harnesses can return a background-process handle immediately.

## Requirements
- ADDED: The agent can request an explicit background mode for a Bash command. Launch returns a collision-resistant task ID and initial status after authorization, process ownership, and output capture are installed; it never waits for command completion.
- ADDED: Background commands use the existing Bash schema validation, effective working directory, tool-permissions evaluation and prompts, audit behavior, shell resolution, and process-tree execution semantics. Background mode must not create a direct process-spawn bypass.
- ADDED: A session-owned registry tracks queued, running, completed, failed, cancelled, and timed-out tasks. It exposes explicit status and bounded stdout/stderr result retrieval by task ID.
- ADDED: Captured output has deterministic line and UTF-8-byte limits, separate stdout/stderr attribution, and visible truncation metadata. Output is not inserted into model context merely because the process runs.
- ADDED: The parent can cancel an active task by ID. Parent abort, session shutdown, reload, new, resume, fork, and extension disposal reject new work, terminate active process trees, close streams, and invalidate late callbacks.
- ADDED: The built-in tool renderer presents launch and lookup rows compactly, including task ID, status, elapsed time, exit outcome, output bounds, and expansion-only output.

## Non-goals
- Persisting or resuming a running process after session shutdown.
- Changing foreground Bash behavior when background mode is absent.
- Automatically delivering process output to the model; e15s02 owns opt-in live monitors.
- Supporting interactive TTY input or detached daemon processes.

## Acceptance criteria
- A long-running authorized Bash command returns its task ID before it completes, and the foreground agent can invoke other tools while it runs.
- A configured deny, cancelled prompt, missing UI, invalid input, or failed authorization prevents process launch exactly as foreground Bash does.
- Status retrieval exposes no output before it exists; terminal retrieval is stable, bounded, and explicitly identifies stdout, stderr, truncation, exit code, signal, timeout, or cancellation.
- Cancelling a task or ending its parent session leaves no owned process or active output reader behind.
- Existing foreground Bash calls retain their current result shape and behavior.

## Automated verification
- `node --test extensions/background-bash/lifecycle.test.ts`
- `node --test extensions/background-bash/output.test.ts`
- `node --test extensions/background-bash/permission-boundary.test.ts`
- `node --test extensions/background-bash/renderer.test.ts`
- `npm run check`

## Implementation notes
Create the smallest compilable public background-Bash stub before each RED test. RED must demonstrate a contract mismatch, not a missing module, export, or function; record RED and GREEN in separate Jujutsu changes. Reuse the existing permission boundary and Bash backend where their contracts permit. A single parent-session registry is the lifecycle authority for launch, lookup, cancellation, stream ownership, and shutdown.

## Definition of done
An authorized command can run in a bounded, cancellable parent-owned background lifecycle with explicit result access, while foreground Bash and permission guarantees remain unchanged.
