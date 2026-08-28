import { getShellConfig } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createOutputCapture, type BackgroundBashOutput } from "./output.ts";
import { createBackgroundBashMonitor, type BackgroundBashMonitor, type BackgroundBashMonitorEvent } from "./monitor.ts";

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
  startedAt?: number;
  finishedAt?: number;
  stdoutPath?: string;
  stderrPath?: string;
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
  launch(options: { command: string; cwd: string; timeoutSeconds?: number; signal?: AbortSignal; outputDir?: string; monitor?: boolean; onMonitorEvent?: (event: BackgroundBashMonitorEvent, taskId: string) => void }): BackgroundBashTask;
  status(id: string): BackgroundBashTask | undefined;
  cancel(id: string): BackgroundBashTask | undefined;
  stopMonitor(id: string): boolean;
  close(): void;
};

/** Spawns commands through Pi's configured shell, owning the detached process tree. */
export function createNodeBashSpawn(): BackgroundBashSpawn {
  return ({ command, cwd, onOutput, onExit }) => {
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
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => onOutput?.("stdout", chunk));
    child.stderr?.on("data", (chunk: string) => onOutput?.("stderr", chunk));
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
  const outputs = new Map<string, ReturnType<typeof createOutputCapture>>();
  const timers = new Map<string, NodeJS.Timeout>();
  const monitors = new Map<string, BackgroundBashMonitor>();
  let closed = false;

  function clearTimer(id: string): void {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
  }

  function settleTerminated(id: string, task: BackgroundBashTask, status: BackgroundBashStatus, exitCode?: number | null, signal?: NodeJS.Signals | null): void {
    if (task.terminal) return;
    task.status = status;
    task.terminal = true;
    if (exitCode !== undefined) task.exitCode = exitCode;
    if (signal !== undefined) task.signal = signal;
    task.output = outputs.get(id)?.snapshot();
    task.finishedAt = Date.now();
    clearTimer(id);
    monitors.get(id)?.close();
    monitors.delete(id);
    processes.delete(id);
  }

  return {
    launch({ command, cwd, timeoutSeconds, signal, outputDir, monitor, onMonitorEvent }) {
      if (closed) throw new Error("Background Bash registry is closed.");
      if (signal?.aborted) throw new Error("Background Bash launch was cancelled by the parent abort signal.");
      const task: BackgroundBashTask = {
        id: `bash-${randomUUID()}`,
        command,
        cwd,
        status: "running",
        terminal: false,
        startedAt: Date.now(),
      };
      tasks.set(task.id, task);
      const output = createOutputCapture();
      outputs.set(task.id, output);
      if (outputDir) {
        mkdirSync(outputDir, { recursive: true });
        task.stdoutPath = join(outputDir, `${task.id}-stdout.log`);
        task.stderrPath = join(outputDir, `${task.id}-stderr.log`);
      }
      if (monitor) monitors.set(task.id, createBackgroundBashMonitor((event) => onMonitorEvent?.(event, task.id)));
      const process = options.spawn({
        command,
        cwd,
        onOutput: (stream, chunk) => {
          output.append(stream, chunk);
          monitors.get(task.id)?.append(stream, chunk);
          if (stream === "stdout" && task.stdoutPath) appendFileSync(task.stdoutPath, chunk);
          else if (task.stderrPath) appendFileSync(task.stderrPath, chunk);
        },
        onExit: ({ code, signal }) => {
          settleTerminated(task.id, task, code === 0 ? "completed" : "failed", code, signal);
        },
      });
      processes.set(task.id, process);
      if (signal) {
        signal.addEventListener("abort", () => {
          process.terminate();
          settleTerminated(task.id, task, "cancelled");
        }, { once: true });
      }
      if (typeof timeoutSeconds === "number" && timeoutSeconds > 0) {
        const timer = setTimeout(() => {
          process.terminate();
          settleTerminated(task.id, task, "timed_out");
        }, timeoutSeconds * 1000);
        timer.unref?.();
        timers.set(task.id, timer);
      }
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
      settleTerminated(id, task, "cancelled");
      return { ...task };
    },
    close() {
      if (closed) return;
      closed = true;
      for (const [id, task] of tasks) {
        if (task.terminal) continue;
        processes.get(id)?.terminate();
        settleTerminated(id, task, "cancelled");
      }
    },
  };
}
