import "../test-support/forbid-fetch.ts";
import assert from "node:assert/strict";
import test from "node:test";
import {
  createUsageExtension,
  DefaultProviderUsageAdapter,
  formatUsageSummary,
  type ProviderUsageAdapter,
  type ProviderUsageResult,
} from "./index.ts";

test("DefaultProviderUsageAdapter returns unsupported state for unknown providers", async () => {
  const adapter = new DefaultProviderUsageAdapter();
  const result = await adapter.getUsage("unknown-provider", "work-account");
  assert.equal(result.supported, false);
  assert.equal((result as any).reason, 'Usage information is unsupported for provider "unknown-provider".');
});

test("formatUsageSummary formats all supported usage fields without inventing missing values", () => {
  const result: ProviderUsageResult = {
    supported: true,
    usage: {
      provider: "anthropic",
      account: "pro-user",
      plan: "Tier 4",
      quotaUsed: 150,
      quotaLimit: 1000,
      quotaUnit: "requests",
      resetTime: "2026-09-01T00:00:00Z",
      costSpent: 12.5,
      costCurrency: "USD",
      rateLimitRequestsPerMin: 60,
      rateLimitTokensPerMin: 100000,
    },
  };

  const formatted = formatUsageSummary(result);
  assert.match(formatted, /Provider: anthropic/);
  assert.match(formatted, /Account: pro-user/);
  assert.match(formatted, /Plan\/Tier: Tier 4/);
  assert.match(formatted, /Quota: 150 \/ 1000 requests/);
  assert.match(formatted, /Reset: 2026-09-01T00:00:00Z/);
  assert.match(formatted, /Cost: \$12\.50 USD/);
  assert.match(formatted, /Rate Limit: 60 req\/min/);
  assert.match(formatted, /Token Limit: 100000 tokens\/min/);
});

test("formatUsageSummary handles safe provider failure messages without exposing credentials", () => {
  const result: ProviderUsageResult = {
    supported: true,
    error: "Authentication failed or token expired.",
    usage: { provider: "openai-compat" },
  };

  const formatted = formatUsageSummary(result);
  assert.match(formatted, /Could not fetch usage for provider "openai-compat": Authentication failed/);
  assert.doesNotMatch(formatted, /sk-/);
  assert.doesNotMatch(formatted, /Bearer/);
});

test("/usage command resolves current provider and active account from Pi context and notifies user", async () => {
  let registeredCommand: string | undefined;
  let commandHandler: ((args: string, ctx: any) => Promise<void>) | undefined;

  const mockAdapter: ProviderUsageAdapter = {
    async getUsage(provider: string, account?: string): Promise<ProviderUsageResult> {
      return {
        supported: true,
        usage: {
          provider,
          account,
          quotaUsed: 42,
          quotaLimit: 100,
        },
      };
    },
  };

  const extension = createUsageExtension(mockAdapter);
  extension({
    registerCommand(name: string, config: any) {
      registeredCommand = name;
      commandHandler = config.handler;
    },
  } as any);

  assert.equal(registeredCommand, "usage");
  assert.ok(commandHandler);

  let notifiedText = "";
  let notifiedLevel = "";
  await commandHandler("", {
    model: { provider: "antigravity", id: "gemini-2.5-pro" },
    account: "favilo-work",
    ui: {
      notify(text: string, level: string) {
        notifiedText = text;
        notifiedLevel = level;
      },
    },
  });

  assert.match(notifiedText, /Provider: antigravity/);
  assert.match(notifiedText, /Account: favilo-work/);
  assert.match(notifiedText, /Quota: 42 \/ 100 requests/);
  assert.equal(notifiedLevel, "info");
});

test("/usage command reflects active account after /accounts:* switching", async () => {
  const requestedAccounts: string[] = [];

  const mockAdapter: ProviderUsageAdapter = {
    async getUsage(provider: string, account?: string): Promise<ProviderUsageResult> {
      requestedAccounts.push(account ?? "none");
      return {
        supported: true,
        usage: { provider, account, quotaUsed: 10 },
      };
    },
  };

  const extension = createUsageExtension(mockAdapter);
  let handler: ((args: string, ctx: any) => Promise<void>) | undefined;
  extension({
    registerCommand(_name: string, config: any) {
      handler = config.handler;
    },
  } as any);

  const ctx: any = {
    model: { provider: "openai-compat", id: "gpt-4o" },
    account: "personal",
    ui: { notify() {} },
  };

  await handler!("", ctx);
  assert.equal(requestedAccounts[0], "personal");

  // User runs /accounts:switch to 'enterprise'
  ctx.account = "enterprise";
  await handler!("", ctx);
  assert.equal(requestedAccounts[1], "enterprise");
});
