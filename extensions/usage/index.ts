import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export interface ProviderUsageInfo {
  provider: string;
  account?: string;
  plan?: string;
  quotaUsed?: number;
  quotaLimit?: number;
  quotaUnit?: string;
  resetTime?: string;
  costSpent?: number;
  costCurrency?: string;
  rateLimitRequestsPerMin?: number;
  rateLimitTokensPerMin?: number;
  rawSummary?: string;
}

export type ProviderUsageResult =
  | { supported: true; usage: ProviderUsageInfo }
  | { supported: false; reason: string }
  | { supported: true; error: string; usage?: Partial<ProviderUsageInfo> };

export interface ProviderUsageAdapter {
  getUsage(provider: string, account?: string): Promise<ProviderUsageResult>;
}

export class DefaultProviderUsageAdapter implements ProviderUsageAdapter {
  async getUsage(provider: string, _account?: string): Promise<ProviderUsageResult> {
    return { supported: false, reason: `Usage information is unsupported for provider "${provider}".` };
  }
}

export function formatUsageSummary(result: ProviderUsageResult, defaultProvider = "unknown", defaultAccount?: string): string {
  if (!result.supported) {
    return result.reason;
  }
  if ("error" in result) {
    return `Could not fetch usage for provider "${result.usage?.provider ?? defaultProvider}": ${result.error}`;
  }

  const { usage } = result;
  const lines: string[] = [
    `Provider: ${usage.provider}`,
    `Account: ${usage.account ?? defaultAccount ?? "default"}`,
  ];

  if (usage.plan) lines.push(`Plan/Tier: ${usage.plan}`);
  if (usage.quotaUsed !== undefined || usage.quotaLimit !== undefined) {
    const unit = usage.quotaUnit ?? "requests";
    lines.push(`Quota: ${usage.quotaUsed ?? 0}${usage.quotaLimit !== undefined ? ` / ${usage.quotaLimit}` : ""} ${unit}`);
  }
  if (usage.resetTime) lines.push(`Reset: ${usage.resetTime}`);
  if (usage.costSpent !== undefined) {
    const currency = usage.costCurrency ?? "USD";
    lines.push(`Cost: $${usage.costSpent.toFixed(2)} ${currency}`);
  }
  if (usage.rateLimitRequestsPerMin !== undefined) {
    lines.push(`Rate Limit: ${usage.rateLimitRequestsPerMin} req/min`);
  }
  if (usage.rateLimitTokensPerMin !== undefined) {
    lines.push(`Token Limit: ${usage.rateLimitTokensPerMin} tokens/min`);
  }
  if (usage.rawSummary) {
    lines.push(`Summary: ${usage.rawSummary}`);
  }

  return lines.join("\n");
}

export function createUsageExtension(adapter?: ProviderUsageAdapter) {
  const usageAdapter = adapter ?? new DefaultProviderUsageAdapter();

  return function (pi: ExtensionAPI): void {
    pi.registerCommand("usage", {
      description: "Show current provider and account usage",
      handler: async (_args, ctx) => {
        const provider = ctx.model?.provider ?? "unknown";
        const account = (ctx as any).account ?? "default";
        const result = await usageAdapter.getUsage(provider, account);
        const output = formatUsageSummary(result, provider, account);
        ctx.ui.notify?.(output, result.supported && !("error" in result) ? "info" : "warning");
      },
    });
  };
}

export default createUsageExtension();
