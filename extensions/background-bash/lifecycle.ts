import { randomUUID } from "node:crypto";

export type BackgroundBashStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";

export type BackgroundBashTask = {
  id: string;
  command: string;
  cwd: string;
  status: BackgroundBashStatus;
  terminal: boolean;
};

export type BackgroundBashProcess = {
  terminate(): void;
};

export type BackgroundBashSpawn = (options: {
  command: string;
  cwd: string;
  onExit: (outcome: { code: number | null; signal: NodeJS.Signals | null }) => void;
}) => BackgroundBashProcess;

export type BackgroundBashController = {
  launch(options: { command: string; cwd: string }): BackgroundBashTask;
  status(id: string): BackgroundBashTask | undefined;
  cancel(id: string): BackgroundBashTask | undefined;
  close(): void;
};

/** Session-scoped authority for background Bash task lifecycle. */
export function createBackgroundBashController(options: { spawn: BackgroundBashSpawn }): BackgroundBashController {
  const tasks = new Map<string, BackgroundBashTask>();
  const processes = new Map<string, BackgroundBashProcess>();
  let closed = false;

  return {
    launch({ command, cwd }) {
      if (closed) throw new Error("Background Bash registry is closed.");
      const task: BackgroundBashTask = {
        id: `bash-${randomUUID()}`,
        command,
        cwd,
        status: "running",
        terminal: false,
      };
      tasks.set(task.id, task);
      const process = options.spawn({
        command,
        cwd,
        onExit: ({ code }) => {
          if (task.terminal) return;
          task.status = code === 0 ? "completed" : "failed";
          task.terminal = true;
          processes.delete(task.id);
        },
      });
      processes.set(task.id, process);
      return { ...task };
    },
    status(id) {
      const task = tasks.get(id);
      return task ? { ...task } : undefined;
    },
    cancel(id) {
      const task = tasks.get(id);
      if (!task || task.terminal) return task ? { ...task } : undefined;
      processes.get(id)?.terminate();
      task.status = "cancelled";
      task.terminal = true;
      processes.delete(id);
      return { ...task };
    },
    close() {
      if (closed) return;
      closed = true;
      for (const [id, task] of tasks) {
        if (task.terminal) continue;
        processes.get(id)?.terminate();
        task.status = "cancelled";
        task.terminal = true;
        processes.delete(id);
      }
    },
  };
}
