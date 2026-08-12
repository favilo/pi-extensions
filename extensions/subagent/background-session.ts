import { randomUUID } from "node:crypto";

export type BackgroundChildStatus =
  | "queued"
  | "running"
  | "waiting-for-permission"
  | "completed"
  | "failed"
  | "cancelled";

export type BackgroundTaskSnapshot = {
  id: string;
  cwd: string;
  status: BackgroundChildStatus;
  terminal: boolean;
};

export type BackgroundTaskRegistry = {
  register(cwd: string): BackgroundTaskSnapshot;
  get(id: string): BackgroundTaskSnapshot | undefined;
  transition(id: string, status: BackgroundChildStatus): BackgroundTaskSnapshot | undefined;
};

const TERMINAL_STATUSES = new Set<BackgroundChildStatus>(["completed", "failed", "cancelled"]);

function snapshot(task: BackgroundTaskSnapshot): BackgroundTaskSnapshot {
  return { ...task };
}

/** Creates the session-scoped authority for background child identity and lifecycle. */
export function createBackgroundTaskRegistry(): BackgroundTaskRegistry {
  const tasks = new Map<string, BackgroundTaskSnapshot>();

  return {
    register(cwd) {
      if ([...tasks.values()].some((task) => !task.terminal)) {
        throw new Error("Only one active background child is allowed until permission prompts are serialized.");
      }

      let id = randomUUID();
      while (tasks.has(id)) id = randomUUID();
      const task = { id, cwd, status: "queued" as const, terminal: false };
      tasks.set(id, task);
      return snapshot(task);
    },

    get(id) {
      const task = tasks.get(id);
      return task ? snapshot(task) : undefined;
    },

    transition(id, status) {
      const task = tasks.get(id);
      if (!task) return undefined;
      if (!task.terminal) {
        task.status = status;
        task.terminal = TERMINAL_STATUSES.has(status);
      }
      return snapshot(task);
    },
  };
}
