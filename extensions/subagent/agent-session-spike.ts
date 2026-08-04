import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";

export type SubagentSession = {
  sessionId: string;
  cwd?: string;
  prompt(text: string): Promise<void>;
  dispose(): void;
};

export type CreateSubagentSession = (options: { cwd: string }) => Promise<SubagentSession>;

export type SubagentSessionRunOptions = {
  cwd: string;
  parentContext: string;
  task: string;
  createSession: CreateSubagentSession;
};

export type SubagentSessionRunResult = {
  sessionId: string;
  cwd: string;
  completed: boolean;
  disposed: boolean;
};

export async function createSubagentSession(cwd: string): Promise<SubagentSession> {
  const { session } = await createAgentSession({
    cwd,
    noTools: "all",
    sessionManager: SessionManager.inMemory(cwd),
  });
  return {
    sessionId: session.sessionId,
    cwd,
    prompt: (text) => session.prompt(text),
    dispose: () => session.dispose(),
  };
}

export async function runSubagentSession(options: SubagentSessionRunOptions): Promise<SubagentSessionRunResult> {
  const session = await options.createSession({ cwd: options.cwd });
  let completed = false;
  let disposed = false;
  try {
    await session.prompt(`${options.parentContext}\n\n${options.task}`);
    completed = true;
  } finally {
    session.dispose();
    disposed = true;
  }
  return { sessionId: session.sessionId, cwd: options.cwd, completed, disposed };
}
