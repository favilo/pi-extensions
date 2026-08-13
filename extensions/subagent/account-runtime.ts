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
  _parameters: SubagentRuntimeParameters,
  _accounts: readonly SubagentAccount[],
  _parentModel: { provider: string; id: string } | undefined,
  _environment: NodeJS.ProcessEnv = process.env,
): ResolvedSubagentRuntime | undefined {
  return undefined;
}
