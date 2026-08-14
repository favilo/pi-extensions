import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

export type SubagentRuntimeParameters = {
  account?: string;
  model?: string;
};

export type PublishedChildRuntimeSelection = {
  descriptor: Readonly<{
    accountId: string;
    provider: string;
    modelId: string;
    source: "explicit" | "one-shot" | "inherited";
  }>;
  installOauth(registry: unknown): void;
  consume(): Promise<void>;
};

export type PublishedChildRuntimeApi = {
  resolve(input: SubagentRuntimeParameters & { parentModel?: { provider: string; id: string } }): Promise<PublishedChildRuntimeSelection | undefined>;
};

export const CHILD_RUNTIME_API = Symbol.for("pi-account-switcher.child-runtime.v1");
const CHILD_RUNTIME_SELECTION = Symbol.for("pi-extensions.subagent.runtime-selection.v1");

type RuntimeSelectionCarrier = Record<symbol, PublishedChildRuntimeSelection | undefined>;

/**
 * Resolve a redacted child selection before approval and preserve it on Pi's
 * mutable tool-call input for the matching executor invocation.
 */
export async function resolveChildRuntimeSelection(
  parameters: SubagentRuntimeParameters,
  parentModel: { provider: string; id: string } | undefined,
  api = getPublishedChildRuntimeApi(),
): Promise<PublishedChildRuntimeSelection | undefined> {
  return api?.resolve({ ...parameters, parentModel });
}

export function attachChildRuntimeSelection(
  input: object,
  selection: PublishedChildRuntimeSelection | undefined,
): void {
  const carrier = input as RuntimeSelectionCarrier;
  if (!selection) {
    delete carrier[CHILD_RUNTIME_SELECTION];
    return;
  }
  Object.defineProperty(carrier, CHILD_RUNTIME_SELECTION, {
    configurable: true,
    enumerable: false,
    value: selection,
    writable: false,
  });
}

export function childRuntimeSelectionFor(
  input: object,
): PublishedChildRuntimeSelection | undefined {
  return (input as RuntimeSelectionCarrier)[CHILD_RUNTIME_SELECTION];
}

export function getPublishedChildRuntimeApi(): PublishedChildRuntimeApi | undefined {
  return (globalThis as Record<symbol, PublishedChildRuntimeApi | undefined>)[CHILD_RUNTIME_API];
}

export type ChildRuntime = {
  modelRuntime: ModelRuntime;
  model: unknown;
  selection: PublishedChildRuntimeSelection;
};

/** Creates a child-local runtime from the exact selection previously approved. */
export async function createChildRuntimeFromSelection(
  selection: PublishedChildRuntimeSelection,
): Promise<ChildRuntime> {
  const modelRuntime = await ModelRuntime.create({ modelsPath: null });
  selection.installOauth(new ModelRegistry(modelRuntime));
  const model = modelRuntime.getModel(selection.descriptor.provider, selection.descriptor.modelId);
  if (!model) throw new Error(`Selected child model is unavailable: ${selection.descriptor.provider}/${selection.descriptor.modelId}`);
  return { modelRuntime, model, selection };
}

export async function createChildSessionWithRuntime<T>(
  input: object,
  createSession: (runtime: ChildRuntime | undefined) => Promise<T>,
  createRuntime: (selection: PublishedChildRuntimeSelection) => Promise<ChildRuntime> = createChildRuntimeFromSelection,
): Promise<T> {
  const selection = childRuntimeSelectionFor(input);
  const runtime = selection ? await createRuntime(selection) : undefined;
  const session = await createSession(runtime);
  await selection?.consume();
  return session;
}

export async function createChildRuntime(
  parameters: SubagentRuntimeParameters,
  parentModel: { provider: string; id: string } | undefined,
  api = getPublishedChildRuntimeApi(),
): Promise<ChildRuntime | undefined> {
  if (!api) return undefined;
  const selection = await resolveChildRuntimeSelection(parameters, parentModel, api);
  return selection ? createChildRuntimeFromSelection(selection) : undefined;
}
