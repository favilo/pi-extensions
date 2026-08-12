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

/**
 * Creates the session-scoped authority for background child identity and lifecycle.
 * This inert implementation establishes the public contract for behavioral RED tests.
 */
export function createBackgroundTaskRegistry(): BackgroundTaskRegistry {
  const pending: BackgroundTaskSnapshot = {
    id: "pending-child",
    cwd: "",
    status: "queued",
    terminal: false,
  };

  return {
    register: () => ({ ...pending }),
    get: () => undefined,
    transition: () => undefined,
  };
}
