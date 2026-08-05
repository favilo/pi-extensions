import { createAgentSession, SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { executeToolRequest, type ToolExecutionResult, type ToolPermissionBoundary, type ToolRequest } from "../tool-permissions/permission-boundary.ts";

export type SubagentSession = {
  sessionId: string;
  cwd?: string;
  prompt(text: string): Promise<void>;
  abort?(): Promise<void> | void;
  dispose(): void;
};

export type CreateSubagentSession = (options: { cwd: string }) => Promise<SubagentSession>;
export type SubagentSessionOptions = {
  customTools?: ToolDefinition[];
  sessionManager?: SessionManager;
};

export type SubagentSessionRunOptions = {
  cwd: string;
  parentContext: string;
  task: string;
  createSession: CreateSubagentSession;
  signal?: AbortSignal;
};

export type SubagentSessionRunResult = {
  sessionId: string;
  cwd: string;
  completed: boolean;
  disposed: boolean;
};

export type ChildToolCall = { toolName: string; input: unknown };
export type ToolPermissionDecision = "allow" | "deny";
export type ToolInterceptionResult = {
  intercepted: boolean;
  executed: boolean;
  decision: ToolPermissionDecision;
};

export type ToolInterceptionProbeOptions = {
  call: ChildToolCall;
  authorize: (call: ChildToolCall) => Promise<ToolPermissionDecision>;
};

export type ChildToolRequest = Omit<ToolRequest, "actor"> & { childId: string };

export async function executeChildToolRequest(
  request: ChildToolRequest,
  boundary: ToolPermissionBoundary,
  signal?: AbortSignal,
): Promise<ToolExecutionResult> {
  const { childId, ...toolRequest } = request;
  return executeToolRequest({ ...toolRequest, actor: { kind: "child", childId } }, boundary, signal);
}

export function validateNestingDepth(depth: number, maximum: number): void {
  if (depth >= maximum) throw new Error(`Exceeded maximum nesting depth of ${maximum}.`);
}

export async function createSubagentSession(cwd: string, options: SubagentSessionOptions = {}): Promise<SubagentSession> {
  const { session } = await createAgentSession({
    cwd,
    noTools: "all",
    customTools: options.customTools ?? [],
    sessionManager: options.sessionManager ?? SessionManager.inMemory(cwd),
  });
  return {
    sessionId: session.sessionId,
    cwd,
    prompt: (text) => session.prompt(text),
    dispose: () => session.dispose(),
  };
}

export async function runSubagentSession(options: SubagentSessionRunOptions): Promise<SubagentSessionRunResult> {
  if (options.signal?.aborted) throw new Error("Subagent session aborted before start.");
  const session = await options.createSession({ cwd: options.cwd });
  let completed = false;
  let disposed = false;
  const abort = () => { void session.abort?.(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    await session.prompt(`${options.parentContext}\n\n${options.task}`);
    completed = true;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    session.dispose();
    disposed = true;
  }
  return { sessionId: session.sessionId, cwd: options.cwd, completed, disposed };
}

export async function runToolInterceptionProbe(options: ToolInterceptionProbeOptions): Promise<ToolInterceptionResult> {
  const decision = await options.authorize(options.call);
  return { intercepted: true, executed: decision === "allow", decision };
}
