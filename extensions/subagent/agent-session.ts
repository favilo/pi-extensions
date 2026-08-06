import { statSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createAgentSession, DefaultResourceLoader, getAgentDir, SessionManager, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { executeToolRequest, type ToolExecutionResult, type ToolPermissionBoundary, type ToolRequest } from "../tool-permissions/permission-boundary.ts";

export type SubagentSession = {
  sessionId: string;
  cwd?: string;
  prompt(text: string): Promise<void>;
  getLastAssistantText?(): string | undefined;
  getActiveToolNames?(): string[];
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
  output?: string;
};

export function resolveSubagentCwd(parentCwd: string, requestedCwd?: string): string {
  const parent = canonicalDirectory(parentCwd, "Parent working directory");
  const candidate = requestedCwd === undefined
    ? parent
    : resolve(parent, requestedCwd);
  const child = canonicalDirectory(candidate, "Child working directory");
  const childRelativePath = relative(parent, child);
  if (childRelativePath === ".." || childRelativePath.startsWith(`..${sep}`) || isAbsolute(childRelativePath)) {
    throw new Error("Child working directory is outside the parent working directory.");
  }
  return child;
}

function canonicalDirectory(path: string, label: string): string {
  let canonical: string;
  try {
    canonical = realpathSync(path);
  } catch {
    throw new Error(`${label} does not exist.`);
  }
  try {
    if (!statSync(canonical).isDirectory()) throw new Error();
  } catch {
    throw new Error(`${label} is not a directory.`);
  }
  return canonical;
}

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
    tools: options.customTools?.map((tool) => tool.name) ?? [],
    customTools: options.customTools ?? [],
    resourceLoader: new DefaultResourceLoader({ cwd, agentDir: getAgentDir(), noExtensions: true }),
    sessionManager: options.sessionManager ?? SessionManager.inMemory(cwd),
  });
  return {
    sessionId: session.sessionId,
    cwd,
    prompt: (text) => session.prompt(text),
    getLastAssistantText: () => session.getLastAssistantText(),
    getActiveToolNames: () => session.getActiveToolNames(),
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
  return {
    sessionId: session.sessionId,
    cwd: options.cwd,
    completed,
    disposed,
    ...(session.getLastAssistantText?.() === undefined ? {} : { output: session.getLastAssistantText?.() }),
  };
}

export async function runToolInterceptionProbe(options: ToolInterceptionProbeOptions): Promise<ToolInterceptionResult> {
  const decision = await options.authorize(options.call);
  return { intercepted: true, executed: decision === "allow", decision };
}
