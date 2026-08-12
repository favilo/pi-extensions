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

type QueuedPrompt<T = unknown> = PermissionPromptJob<T> & {
  resolve(value: T): void;
  reject(reason: unknown): void;
  settled: boolean;
  controller?: AbortController;
  removeAbortListener?: () => void;
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

/** Serializes every interactive permission decision owned by one Pi session. */
export class PermissionPromptQueue {
  #closed = false;
  #pending: QueuedPrompt[] = [];
  #active?: QueuedPrompt;

  enqueue<T>(job: PermissionPromptJob<T>): Promise<T> {
    if (this.#closed || job.signal?.aborted) return Promise.resolve(job.cancel);

    return new Promise<T>((resolve, reject) => {
      const queued: QueuedPrompt<T> = { ...job, resolve, reject, settled: false };
      if (job.signal) {
        const cancel = () => this.#cancel(queued);
        job.signal.addEventListener("abort", cancel, { once: true });
        queued.removeAbortListener = () => job.signal?.removeEventListener("abort", cancel);
      }
      this.#pending.push(queued as QueuedPrompt);
      this.#pump();
    });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#active) {
      this.#settle(this.#active, this.#active.cancel);
      this.#active.controller?.abort();
    }
    for (const queued of this.#pending.splice(0)) this.#settle(queued, queued.cancel);
  }

  #cancel<T>(queued: QueuedPrompt<T>): void {
    if (queued.settled) return;
    this.#settle(queued, queued.cancel);
    if (this.#active === queued) {
      queued.controller?.abort();
      return;
    }
    const index = this.#pending.indexOf(queued as QueuedPrompt);
    if (index >= 0) this.#pending.splice(index, 1);
  }

  #settle<T>(queued: QueuedPrompt<T>, value: T): void {
    if (queued.settled) return;
    queued.settled = true;
    queued.removeAbortListener?.();
    queued.resolve(value);
  }

  #pump(): void {
    if (this.#closed || this.#active) return;
    const queued = this.#pending.shift();
    if (!queued) return;
    if (queued.settled) {
      this.#pump();
      return;
    }

    this.#active = queued;
    queued.controller = new AbortController();
    void queued.present(queued.controller.signal)
      .then((value) => this.#settle(queued, value))
      .catch((error) => {
        if (queued.settled) return;
        queued.settled = true;
        queued.removeAbortListener?.();
        queued.reject(error);
      })
      .finally(() => {
        if (this.#active === queued) this.#active = undefined;
        this.#pump();
      });
  }
}

const SESSION_QUEUES_KEY = Symbol.for("pi-extensions.tool-permissions.session-prompt-queues");

type ProcessGlobal = { [key: symbol]: unknown };
type SessionQueueRegistry = Map<string, PermissionPromptQueue>;

function sessionQueueRegistry(): SessionQueueRegistry {
  const processGlobal = globalThis as ProcessGlobal;
  const current = processGlobal[SESSION_QUEUES_KEY] as SessionQueueRegistry | undefined;
  if (current) return current;
  const registry: SessionQueueRegistry = new Map();
  processGlobal[SESSION_QUEUES_KEY] = registry;
  return registry;
}

/**
 * ExtensionAPI wrappers and Jiti module graphs are extension-local. The process
 * global only hosts a registry; each active top-level parent session owns an
 * independent queue selected by its stable Pi session ID.
 */
export function permissionPromptQueueFor(parentSessionId: string): PermissionPromptQueue {
  const registry = sessionQueueRegistry();
  const current = registry.get(parentSessionId);
  if (current) return current;
  const queue = new PermissionPromptQueue();
  registry.set(parentSessionId, queue);
  return queue;
}

export function closePermissionPromptQueue(parentSessionId: string): void {
  const registry = sessionQueueRegistry();
  registry.get(parentSessionId)?.close();
  registry.delete(parentSessionId);
  if (registry.size === 0) delete (globalThis as ProcessGlobal)[SESSION_QUEUES_KEY];
}
