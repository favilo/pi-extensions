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
};

export type BackgroundResult =
  | { found: false; status: "unknown" }
  | (BackgroundTaskSnapshot & {
    found: true;
    events: ReturnType<ReturnType<typeof createBackgroundEventBuffer>["snapshot"]>;
    output?: string;
  });

export type BackgroundSessionController = {
  launch(options: BackgroundLaunchOptions): Promise<BackgroundTaskSnapshot>;
  result(id: string): BackgroundResult;
};

export type BackgroundCompletionSignal = {
  customType: "subagent_finished";
  content: string;
  display: false;
  details: { id: string; status: "completed" | "failed" | "cancelled" };
};

export type BackgroundControllerOptions = {
  notify?: (message: BackgroundCompletionSignal, options: { deliverAs: "nextTurn"; triggerTurn: false }) => void;
};

export type CreateManagedSubagentSession = (options: {
  childId: string;
  cwd: string;
  signal: AbortSignal;
}) => Promise<ManagedSubagentSession>;

const DEFAULT_EVENT_LIMITS: BackgroundEventLimits = {
  maxEvents: 1_000,
  maxEventBytes: 64 * 1_024,
  maxTotalBytes: 2 * 1_024 * 1_024,
};

/** Owns child launch authority beyond the foreground tool invocation. */
export function createBackgroundSessionController(
  createSession: CreateManagedSubagentSession,
  _options: BackgroundControllerOptions = {},
): BackgroundSessionController {
  const registry = createBackgroundTaskRegistry();
  const runtimes = new Map<string, {
    session: ManagedSubagentSession;
    events: ReturnType<typeof createBackgroundEventBuffer>;
    output?: string;
  }>();

  return {
    result(id) {
      const task = registry.get(id);
      const runtime = runtimes.get(id);
      if (!task || !runtime) return { found: false, status: "unknown" };
      return {
        found: true,
        ...task,
        events: runtime.events.snapshot(),
        ...(task.terminal && runtime.output !== undefined ? { output: runtime.output } : {}),
      };
    },

    async launch(options) {
      const task = registry.register(options.cwd);
      const cancellation = new AbortController();
      let session: ManagedSubagentSession;
      try {
        session = await createSession({ childId: task.id, cwd: options.cwd, signal: cancellation.signal });
      } catch (error) {
        registry.transition(task.id, "failed");
        throw error;
      }

      const events = createBackgroundEventBuffer(task.id, DEFAULT_EVENT_LIMITS);
      const runtime = { session, events, output: undefined as string | undefined };
      runtimes.set(task.id, runtime);
      const unsubscribe = session.subscribe((event) => events.append(event));
      registry.transition(task.id, "running");
      void session.prompt(`${options.parentContext}\n\n${options.task}`)
        .then(
          () => {
            runtime.output = session.getLastAssistantText?.();
            registry.transition(task.id, "completed");
          },
          () => { registry.transition(task.id, cancellation.signal.aborted ? "cancelled" : "failed"); },
        )
        .finally(() => {
          events.seal();
          unsubscribe();
          session.dispose();
        });

      return registry.get(task.id)!;
    },
  };
}
