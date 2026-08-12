import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { BackgroundTaskSnapshot } from "./background-session.ts";

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

export type BackgroundSessionController = {
  launch(options: BackgroundLaunchOptions): Promise<BackgroundTaskSnapshot>;
};

export type CreateManagedSubagentSession = (options: {
  childId: string;
  cwd: string;
  signal: AbortSignal;
}) => Promise<ManagedSubagentSession>;

/** Establishes the compilable controller boundary for behavioral RED. */
export function createBackgroundSessionController(
  _createSession: CreateManagedSubagentSession,
): BackgroundSessionController {
  return {
    async launch(options) {
      return {
        id: "pending-child",
        cwd: options.cwd,
        status: "completed",
        terminal: true,
      };
    },
  };
}
