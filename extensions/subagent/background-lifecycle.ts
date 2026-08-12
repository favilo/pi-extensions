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
  notify?: (message: BackgroundCompletionSignal, options: { deliverAs: "nextTurn"; triggerTurn: false }) => void;
  cleanupTimeoutMs?: number;
  maxRetainedResults?: number;
  maxOutputBytes?: number;
};

export type CreateManagedSubagentSession = (options: {
  childId: string;
  cwd: string;
  signal: AbortSignal;
}) => Promise<ManagedSubagentSession>;

const DEFAULT_CLEANUP_TIMEOUT_MS = 2_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1_024;
const DEFAULT_MAX_RETAINED_RESULTS = 20;

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
    controllerOptions.notify?.({
      customType: "subagent_finished",
      content: `subagent_finished:${id}:${status}`,
      display: false,
      details: { id, status },
    }, { deliverAs: "nextTurn", triggerTurn: false });
  }

  async function waitForAbort(session: ManagedSubagentSession): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = Promise.resolve(session.abort?.()).catch(() => undefined);
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, controllerOptions.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS);
    });
    await Promise.race([abort, timeout]);
    if (timer) clearTimeout(timer);
  }

  function cleanup(id: string): void {
    const runtime = runtimes.get(id);
    if (!runtime || runtime.cleaned) return;
    runtime.cleaned = true;
    runtime.events.seal();
    runtime.unsubscribe();
    runtime.session.dispose();
  }

  return {
    setStatus(id, status) {
      return registry.transition(id, status);
    },

    async close() {
      if (closed) return;
      closed = true;
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
      let session: ManagedSubagentSession;
      try {
        session = await (options.createSession ?? createSession)({ childId: task.id, cwd: options.cwd, signal: cancellation.signal });
      } catch (error) {
        registry.transition(task.id, "failed");
        throw error;
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
      };
      runtimes.set(task.id, runtime);
      runtime.unsubscribe = session.subscribe((event) => events.append(event));
      registry.transition(task.id, "running");
      void session.prompt(`${options.parentContext}\n\n${options.task}`)
        .then(
          () => {
            const output = session.getLastAssistantText?.();
            if (output !== undefined) {
              const maximum = controllerOptions.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
              const encoded = Buffer.from(output, "utf8");
              runtime.outputTruncated = encoded.byteLength > maximum;
              runtime.output = encoded.subarray(0, maximum).toString("utf8");
            }
            finish(task.id, "completed");
          },
          () => { finish(task.id, cancellation.signal.aborted ? "cancelled" : "failed"); },
        )
        .finally(() => cleanup(task.id));

      return registry.get(task.id)!;
    },
  };
}
