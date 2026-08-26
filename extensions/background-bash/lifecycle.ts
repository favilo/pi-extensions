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
export function createBackgroundBashController(_options: { spawn: BackgroundBashSpawn }): BackgroundBashController {
  const task: BackgroundBashTask = {
    id: "bash-stub",
    command: "",
    cwd: "",
    status: "completed",
    terminal: true,
  };

  return {
    launch() {
      return { ...task };
    },
    status() {
      return undefined;
    },
    cancel() {
      return undefined;
    },
    close() {},
  };
}
