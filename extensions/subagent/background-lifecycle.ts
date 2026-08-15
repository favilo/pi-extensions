import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { createBackgroundEventBuffer, type BackgroundEventLimits } from "./background-events.ts";
import { createBackgroundTaskRegistry, type BackgroundTaskSnapshot } from "./background-session.ts";

export type ManagedSubagentSession = {
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  abort?(): Promise<void> | void;
  dispose(): void;
  getLastAssistantText?(): string | undefined;
};

export type BackgroundLaunchOptions = {
  cwd: string;
  parentContext: string;
  task: string;
  invocationSignal?: AbortSignal;
  createSession?: CreateManagedSubagentSession;
};

export type BackgroundResult =
  | { found: false; status: "unknown" }
  | (BackgroundTaskSnapshot & {
    found: true;
    events: ReturnType<ReturnType<typeof createBackgroundEventBuffer>["snapshot"]>;
    output?: string;
    outputTruncated?: boolean;
  });

export type BackgroundSessionController = {
  launch(options: BackgroundLaunchOptions): Promise<BackgroundTaskSnapshot>;
  result(id: string): BackgroundResult;
  setStatus(id: string, status: "running" | "waiting-for-permission"): BackgroundTaskSnapshot | undefined;
  close(): Promise<void>;
};

export type BackgroundCompletionSignal = {
  customType: "subagent_finished";
  content: string;
  display: false;
  details: { id: string; status: "completed" | "failed" | "cancelled" };
};

export type BackgroundControllerOptions = {
  notify?: (message: BackgroundCompletionSignal, options: { deliverAs: "steer"; triggerTurn: true }) => void;
  cleanupTimeoutMs?: number;
  maxRetainedResults?: number;
  maxOutputBytes?: number;
  debug?: (event: string, details: Record<string, unknown>) => void;
};

export type CreateManagedSubagentSession = (options: {
  childId: string;
  cwd: string;
  signal: AbortSignal;
}) => Promise<ManagedSubagentSession>;

const DEFAULT_CLEANUP_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_024 * 1_024;
const DEFAULT_MAX_RETAINED_RESULTS = 20;

function truncateUtf8(value: string, maximum: number): { value: string; truncated: boolean } {
  const encoded = Buffer.byteLength(value, "utf8");
  if (encoded <= maximum) return { value, truncated: false };
  let bounded = "";
  for (const character of value) {
    if (Buffer.byteLength(`${bounded}${character}`, "utf8") > maximum) break;
    bounded += character;
  }
  return { value: bounded, truncated: true };
}

const DEFAULT_EVENT_LIMITS: BackgroundEventLimits = {
  maxEvents: 1_000,
  maxEventBytes: 64 * 1_024,
  maxTotalBytes: 2 * 1_024 * 1_024,
};

/** Owns child launch authority beyond the foreground tool invocation. */
export function createBackgroundSessionController(
  createSession: CreateManagedSubagentSession,
  controllerOptions: BackgroundControllerOptions = {},
): BackgroundSessionController {
  const registry = createBackgroundTaskRegistry();
  const runtimes = new Map<string, {
    session: ManagedSubagentSession;
    events: ReturnType<typeof createBackgroundEventBuffer>;
    cancellation: AbortController;
    unsubscribe: () => void;
    output?: string;
    outputTruncated?: boolean;
    cleaned: boolean;
    detachInvocationAbort: () => void;
  }>();
  const pendingConstructions = new Map<string, {
    settled: Promise<void>;
    detachInvocationAbort: () => void;
    interruptLaunch: (error: Error) => void;
  }>();
  let closed = false;
  const terminalOrder: string[] = [];

  function retainTerminal(id: string): void {
    terminalOrder.push(id);
    const maximum = controllerOptions.maxRetainedResults ?? DEFAULT_MAX_RETAINED_RESULTS;
    while (terminalOrder.length > maximum) {
      const evicted = terminalOrder.shift();
      if (!evicted) return;
      runtimes.delete(evicted);
      registry.remove(evicted);
    }
  }

  function finish(id: string, status: "completed" | "failed" | "cancelled"): void {
    const current = registry.get(id);
    if (!current || current.terminal) return;
    registry.transition(id, status);
    retainTerminal(id);
    if (!closed) {
      controllerOptions.notify?.({
        customType: "subagent_finished",
        content: `subagent_finished:${id}:${status}`,
        display: false,
        details: { id, status },
      }, { deliverAs: "steer", triggerTurn: true });
    }
  }

  async function waitWithinCleanupBound(operation: Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, controllerOptions.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS);
    });
    await Promise.race([operation.then(() => undefined, () => undefined), timeout]);
    if (timer) clearTimeout(timer);
  }

  async function waitForAbort(session: ManagedSubagentSession): Promise<void> {
    await waitWithinCleanupBound(Promise.resolve().then(() => session.abort?.()));
  }

  async function disposeStaleSession(session: ManagedSubagentSession): Promise<void> {
    await waitForAbort(session);
    try {
      session.dispose();
    } catch {
      // A stale session must not escape shutdown even if disposal reports an error.
    }
  }

  function cleanup(id: string): void {
    const runtime = runtimes.get(id);
    if (!runtime || runtime.cleaned) return;
    runtime.cleaned = true;
    runtime.detachInvocationAbort();
    runtime.events.seal();
    runtime.unsubscribe();
    runtime.session.dispose();
  }

  async function cancelRuntime(id: string): Promise<void> {
    const runtime = runtimes.get(id);
    if (!runtime || registry.get(id)?.terminal) return;
    runtime.cancellation.abort();
    await waitForAbort(runtime.session);
    finish(id, "cancelled");
    cleanup(id);
  }

  return {
    setStatus(id, status) {
      return registry.transition(id, status);
    },

    async close() {
      if (closed) return;
      closed = true;
      const constructions = [...pendingConstructions.values()];
      for (const construction of constructions) {
        construction.detachInvocationAbort();
        construction.interruptLaunch(new Error("Background child registry closed during session construction."));
      }
      await waitWithinCleanupBound(Promise.all(constructions.map(({ settled }) => settled)));

      for (const [id, runtime] of runtimes) {
        if (!registry.get(id)?.terminal) {
          runtime.cancellation.abort();
          await waitForAbort(runtime.session);
          finish(id, "cancelled");
        }
        cleanup(id);
      }
    },

    result(id) {
      const task = registry.get(id);
      const runtime = runtimes.get(id);
      if (!task || !runtime) return { found: false, status: "unknown" };
      return {
        found: true,
        ...task,
        events: runtime.events.snapshot(),
        ...(task.terminal && runtime.output !== undefined ? { output: runtime.output } : {}),
        ...(task.terminal && runtime.outputTruncated ? { outputTruncated: true } : {}),
      };
    },

    async launch(options) {
      if (closed) throw new Error("Background child registry is closed.");
      const task = registry.register(options.cwd);
      const cancellation = new AbortController();
      if (options.invocationSignal?.aborted) {
        cancellation.abort();
        registry.transition(task.id, "cancelled");
        throw new Error("Background child launch was cancelled before session construction.");
      }

      let markConstructionSettled: (() => void) | undefined;
      const settled = new Promise<void>((resolve) => { markConstructionSettled = resolve; });
      let rejectInterruptedLaunch: ((error: Error) => void) | undefined;
      const interruptedLaunch = new Promise<never>((_resolve, reject) => { rejectInterruptedLaunch = reject; });
      let launchInterrupted = false;
      const finishPendingConstruction = (): void => {
        if (pendingConstructions.get(task.id)?.settled !== settled) return;
        pendingConstructions.delete(task.id);
        markConstructionSettled?.();
      };
      const interruptLaunch = (error: Error): void => {
        if (launchInterrupted) return;
        launchInterrupted = true;
        cancellation.abort();
        rejectInterruptedLaunch?.(error);
      };
      const onInvocationAbort = (): void => {
        interruptLaunch(new Error("Background child launch was cancelled during session construction."));
        if (runtimes.has(task.id)) void cancelRuntime(task.id);
      };
      const detachInvocationAbort = options.invocationSignal
        ? () => options.invocationSignal?.removeEventListener("abort", onInvocationAbort)
        : () => {};
      options.invocationSignal?.addEventListener("abort", onInvocationAbort, { once: true });
      pendingConstructions.set(task.id, { settled, detachInvocationAbort, interruptLaunch });
      if (options.invocationSignal?.aborted) onInvocationAbort();

      const construction = Promise.resolve()
        .then(() => (options.createSession ?? createSession)({ childId: task.id, cwd: options.cwd, signal: cancellation.signal }))
        .then(async (session) => {
          if (!closed && !cancellation.signal.aborted) return session;
          await disposeStaleSession(session);
          throw new Error(closed
            ? "Background child registry closed during session construction."
            : "Background child launch was cancelled during session construction.");
        });
      void construction.then(
        () => { if (launchInterrupted) finishPendingConstruction(); },
        () => { if (launchInterrupted) finishPendingConstruction(); },
      );

      let session: ManagedSubagentSession;
      try {
        session = await Promise.race([construction, interruptedLaunch]);
      } catch (error) {
        const cancelled = closed || cancellation.signal.aborted;
        registry.transition(task.id, cancelled ? "cancelled" : "failed");
        detachInvocationAbort();
        if (!launchInterrupted) finishPendingConstruction();
        if (closed) throw new Error("Background child registry closed during session construction.");
        if (cancelled) throw new Error("Background child launch was cancelled during session construction.");
        throw error;
      }

      if (closed || cancellation.signal.aborted) {
        registry.transition(task.id, "cancelled");
        await disposeStaleSession(session);
        detachInvocationAbort();
        finishPendingConstruction();
        throw new Error(closed
          ? "Background child registry closed during session construction."
          : "Background child launch was cancelled during session construction.");
      }

      const events = createBackgroundEventBuffer(task.id, DEFAULT_EVENT_LIMITS);
      const runtime = {
        session,
        events,
        cancellation,
        unsubscribe: () => {},
        output: undefined as string | undefined,
        outputTruncated: undefined as boolean | undefined,
        cleaned: false,
        detachInvocationAbort,
      };
      runtimes.set(task.id, runtime);
      finishPendingConstruction();
      runtime.unsubscribe = session.subscribe((event) => {
        controllerOptions.debug?.("child-session-event", { childId: task.id, eventType: event.type });
        events.append(event);
      });
      registry.transition(task.id, "running");
      controllerOptions.debug?.("child-prompt-start", { childId: task.id });
      void session.prompt(`${options.parentContext}\n\n${options.task}`)
        .then(
          () => {
            controllerOptions.debug?.("child-prompt-resolved", { childId: task.id });
            if (cancellation.signal.aborted) {
              finish(task.id, "cancelled");
              return;
            }
            const output = session.getLastAssistantText?.();
            if (output !== undefined) {
              const bounded = truncateUtf8(output, controllerOptions.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES);
              runtime.outputTruncated = bounded.truncated;
              runtime.output = bounded.value;
            }
            finish(task.id, "completed");
          },
          () => {
            const status = cancellation.signal.aborted ? "cancelled" : "failed";
            controllerOptions.debug?.("child-prompt-rejected", { childId: task.id, status });
            finish(task.id, status);
          },
        )
        .finally(() => cleanup(task.id));

      return registry.get(task.id)!;
    },
  };
}
