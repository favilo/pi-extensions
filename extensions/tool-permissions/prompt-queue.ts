import { createHash, randomUUID } from "node:crypto";
import type { ToolRequest } from "./permission-boundary.ts";

export type PermissionPromptIdentity = Readonly<{
  requestId: string;
  actor: ToolRequest["actor"];
  toolName: string;
  cwd: string;
  inputHash: string;
}>;

export type PermissionPromptJob<T> = {
  identity: PermissionPromptIdentity;
  present(signal: AbortSignal): Promise<T>;
  cancel: T;
  signal?: AbortSignal;
};

function safeInputHash(input: unknown): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(input, (_key, value) => typeof value === "bigint" ? value.toString() : value) ?? "null";
  } catch {
    serialized = "[unserializable]";
  }
  return createHash("sha256").update(serialized).digest("hex");
}

export function createPermissionPromptIdentity(
  request: Pick<ToolRequest, "actor" | "toolName" | "cwd" | "input">,
): PermissionPromptIdentity {
  return Object.freeze({
    requestId: randomUUID(),
    actor: Object.freeze({ ...request.actor }),
    toolName: request.toolName,
    cwd: request.cwd,
    inputHash: safeInputHash(request.input),
  });
}

/** Session-owned presentation seam for permission prompts. */
export class PermissionPromptQueue {
  #closed = false;

  enqueue<T>(job: PermissionPromptJob<T>): Promise<T> {
    if (this.#closed || job.signal?.aborted) return Promise.resolve(job.cancel);
    return job.present(new AbortController().signal);
  }

  close(): void {
    this.#closed = true;
  }
}
