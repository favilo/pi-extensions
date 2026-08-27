import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { BackgroundBashOutput } from "./output.ts";

export type BackgroundBashStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "timed_out";

export type BackgroundBashTask = {
  id: string;
  command: string;
  cwd: string;
  status: BackgroundBashStatus;
  terminal: boolean;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  output?: BackgroundBashOutput;
};

export type BackgroundBashProcess = {
  terminate(): void;
};

export type BackgroundBashSpawn = (options: {
  command: string;
  cwd: string;
  onOutput?: (stream: "stdout" | "stderr", chunk: string) => void;
  onExit: (outcome: { code: number | null; signal: NodeJS.Signals | null }) => void;
}) => BackgroundBashProcess;

export type BackgroundBashController = {
  launch(options: { command: string; cwd: string }): BackgroundBashTask;
  status(id: string): BackgroundBashTask | undefined;
  cancel(id: string): BackgroundBashTask | undefined;
  close(): void;
};

/** Spawns commands through Pi's configured shell, owning the detached process tree. */
export function createNodeBashSpawn(): BackgroundBashSpawn {
  return ({ command, cwd, onExit }) => {
    const shellConfig = getShellConfig();
    const commandFromStdin = shellConfig.commandTransport === "stdin";
    const child = spawn(
      shellConfig.shell,
      commandFromStdin ? shellConfig.args : [...shellConfig.args, command],
      {
        cwd,
        detached: process.platform !== "win32",
        stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    if (commandFromStdin) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(command);
    }
    child.on("error", () => onExit({ code: null, signal: null }));
    child.on("close", (code, signal) => onExit({ code, signal }));
    return {
      terminate() {
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, "SIGTERM");
            return;
          } catch {
            // Fall back to terminating the shell process alone.
          }
        }
        child.kill("SIGTERM");
      },
    };
  };
}

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
