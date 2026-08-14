import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";

export type SubagentRuntimeParameters = {
  account?: string;
  model?: string;
};

export type AccountOauthEntry = {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;
};

export type SubagentAccount = {
  id: string;
  label: string;
  provider: string;
  model?: string;
  piAuth?: {
    provider: string;
    entry: AccountOauthEntry;
  };
};

export type ResolvedSubagentRuntime = {
  account: SubagentAccount;
  accountSource: "explicit" | "one-shot" | "inherited";
  model: { provider: string; id: string };
  consumeOneShot: boolean;
};

type AccountConfigFile = { accounts?: SubagentAccount[] };

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
  _parameters: SubagentRuntimeParameters,
  _parentModel: { provider: string; id: string } | undefined,
  _api = getPublishedChildRuntimeApi(),
): Promise<PublishedChildRuntimeSelection | undefined> {
  void _parameters;
  void _parentModel;
  void _api;
  return undefined;
}

export function attachChildRuntimeSelection(
  _input: object,
  _selection: PublishedChildRuntimeSelection | undefined,
): void {
  void _input;
  void _selection;
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

export async function createChildRuntime(
  parameters: SubagentRuntimeParameters,
  parentModel: { provider: string; id: string } | undefined,
  api = getPublishedChildRuntimeApi(),
): Promise<ChildRuntime | undefined> {
  if (!api) return undefined;
  const selection = await api.resolve({ ...parameters, parentModel });
  if (!selection) return undefined;
  const modelRuntime = await ModelRuntime.create({ modelsPath: null });
  selection.installOauth(new ModelRegistry(modelRuntime));
  const model = modelRuntime.getModel(selection.descriptor.provider, selection.descriptor.modelId);
  if (!model) throw new Error(`Selected child model is unavailable: ${selection.descriptor.provider}/${selection.descriptor.modelId}`);
  return { modelRuntime, model, selection };
}

export type DebugChildRuntime = {
  modelRuntime: ModelRuntime;
  model: unknown;
  selected: ResolvedSubagentRuntime;
};

/** Resolves the account and model for a child without changing parent process state. */
export function resolveSubagentRuntime(
  parameters: SubagentRuntimeParameters,
  accounts: readonly SubagentAccount[],
  parentModel: { provider: string; id: string } | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): ResolvedSubagentRuntime | undefined {
  const requested = parameters.account
    ? { id: parameters.account, source: "explicit" as const }
    : environment.PI_ACCOUNT_SWITCHER_NEXT_ID
      ? { id: environment.PI_ACCOUNT_SWITCHER_NEXT_ID, source: "one-shot" as const }
      : environment.PI_ACCOUNT_SWITCHER_ACTIVE_ID
        ? { id: environment.PI_ACCOUNT_SWITCHER_ACTIVE_ID, source: "inherited" as const }
        : undefined;
  if (!requested) return undefined;

  const account = accounts.find((candidate) => candidate.id === requested.id);
  if (!account) throw new Error(`Selected child account was not found: ${requested.id}`);
  const model = resolveModel(parameters.model, account, parentModel);
  if (model.provider !== account.provider) {
    throw new Error(`Selected model provider ${model.provider} does not match selected account provider ${account.provider}.`);
  }
  return {
    account,
    accountSource: requested.source,
    model,
    consumeOneShot: requested.source === "one-shot",
  };
}

/**
 * UAT-only bridge to an explicitly located installed account-switcher package.
 * This clones OAuth auth into a child ModelRuntime and does not change the
 * parent runtime or process environment.
 */
export async function createDebugChildRuntime(
  parameters: SubagentRuntimeParameters,
  parentModel: { provider: string; id: string } | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<DebugChildRuntime | undefined> {
  if (environment.PI_SUBAGENT_ACCOUNT_SWITCHER_DEBUG !== "1") return undefined;
  const root = environment.PI_ACCOUNT_SWITCHER_ROOT;
  if (!root) throw new Error("PI_ACCOUNT_SWITCHER_ROOT is required for account-switcher debug UAT.");
  accessSync(join(root, "src", "index.ts"), constants.R_OK);

  const configPath = join(homedir(), ".pi", "account-switcher", "accounts.json");
  const config = JSON.parse(readFileSync(configPath, "utf8")) as AccountConfigFile;
  const selected = resolveSubagentRuntime(parameters, config.accounts ?? [], parentModel, environment);
  if (!selected) return undefined;
  if (selected.account.provider !== "openai-codex" || selected.account.piAuth?.provider !== "openai-codex") {
    throw new Error(`Debug child runtime supports only openai-codex OAuth accounts; ${selected.account.id} is unsupported.`);
  }

  const modelRuntime = await ModelRuntime.create({ modelsPath: null });
  installOauthAccount(new ModelRegistry(modelRuntime), selected.account);
  const model = modelRuntime.getModel(selected.model.provider, selected.model.id);
  if (!model) throw new Error(`Selected child model is unavailable: ${selected.model.provider}/${selected.model.id}`);
  return { modelRuntime, model, selected };
}

function installOauthAccount(registry: ModelRegistry, account: SubagentAccount): void {
  const credential = account.piAuth?.entry;
  if (!credential) throw new Error(`Selected child account ${account.id} has no OAuth credential.`);
  const provider = registry.getProvider(account.provider);
  const oauth = provider?.auth.oauth;
  if (!provider || !oauth) throw new Error(`Selected child provider does not support OAuth: ${account.provider}`);

  const resolve = async () => oauth.toAuth(credential);
  registry.registerProvider({
    ...provider,
    auth: {
      apiKey: {
        name: `${provider.name} child account OAuth`,
        check: async () => ({ source: "Subagent account", type: "oauth" }),
        resolve: async () => ({ auth: await resolve(), source: "Subagent account" }),
      },
      oauth: { ...oauth, toAuth: resolve },
    },
  });
}

function resolveModel(
  requestedModel: string | undefined,
  account: SubagentAccount,
  parentModel: { provider: string; id: string } | undefined,
): { provider: string; id: string } {
  if (requestedModel) {
    const separator = requestedModel.indexOf("/");
    if (separator <= 0 || separator === requestedModel.length - 1) {
      throw new Error("Selected child model must use provider/model-id format.");
    }
    return { provider: requestedModel.slice(0, separator), id: requestedModel.slice(separator + 1) };
  }
  if (account.model) return { provider: account.provider, id: account.model };
  if (parentModel) return parentModel;
  throw new Error(`Selected child account ${account.id} requires an explicit model.`);
}
