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
