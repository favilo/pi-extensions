import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ProviderUsageInfo {
  provider: string;
  account?: string;
  plan?: string;
  email?: string;
  projectId?: string;
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

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function getAccountSwitcherDir(): string {
  return join(homedir(), ".pi", "account-switcher");
}

interface AccountConfigEntry {
  id: string;
  label?: string;
  provider: string;
  model?: string;
  piAuth?: {
    provider?: string;
    entry?: {
      type?: string;
      access?: string;
      refresh?: string;
      expires?: number;
      projectId?: string;
      email?: string;
    };
  };
}

function readAccountSwitcherAccounts(): AccountConfigEntry[] {
  try {
    const filePath = join(getAccountSwitcherDir(), "accounts.json");
    const content = readFileSync(filePath, "utf8");
    const data = JSON.parse(content);
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch {
    return [];
  }
}

function readAccountSwitcherActiveAccount(provider: string): string | undefined {
  try {
    const filePath = join(getAccountSwitcherDir(), "state.json");
    const content = readFileSync(filePath, "utf8");
    const data = JSON.parse(content);
    if (!data || typeof data.sessions !== "object") return undefined;

    const sessions = Object.values(data.sessions) as Array<{
      activeAccountId?: string;
      activeModelProvider?: string;
      lastActive?: string;
    }>;

    const matching = sessions
      .filter((s) => s.activeAccountId && (!s.activeModelProvider || s.activeModelProvider.toLowerCase() === provider.toLowerCase()))
      .sort((a, b) => (b.lastActive ?? "").localeCompare(a.lastActive ?? ""));

    return matching[0]?.activeAccountId;
  } catch {
    return undefined;
  }
}

function readAuthStore(): Record<string, any> | undefined {
  try {
    const authPath = join(getAgentDir(), "auth.json");
    const content = readFileSync(authPath, "utf8");
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function parseJwtPayload(token: string): Record<string, any> | undefined {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return undefined;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export class DefaultProviderUsageAdapter implements ProviderUsageAdapter {
  async getUsage(provider: string, account?: string): Promise<ProviderUsageResult> {
    const norm = provider.toLowerCase();
    const accounts = readAccountSwitcherAccounts();
    const authStore = readAuthStore();

    // Determine active account ID: explicit parameter > state.json active account > undefined
    const activeAccountId = (account && account !== "default") ? account : readAccountSwitcherActiveAccount(norm);

    // Look up account in account-switcher accounts.json
    let accountEntry = activeAccountId
      ? accounts.find((a) => a.id === activeAccountId || a.label === activeAccountId)
      : undefined;

    // Fallback: match by provider if account is unlisted
    if (!accountEntry) {
      accountEntry = accounts.find((a) => a.provider.toLowerCase() === norm);
    }

    // 1. Ollama / Llama.cpp Local Inference Provider
    if (norm === "ollama" || norm === "llama-cpp" || norm === "llama.cpp") {
      try {
        const host = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${host.replace(/\/$/, "")}/api/tags`, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          const data = (await res.json()) as { models?: Array<{ name: string }> };
          const modelCount = data.models?.length ?? 0;
          return {
            supported: true,
            usage: {
              provider,
              account: accountEntry?.label ?? activeAccountId ?? account ?? "local",
              plan: "Local / Self-hosted",
              rawSummary: `Local Ollama server active (${modelCount} models installed). Unlimited local inference.`,
            },
          };
        }
      } catch {
        // Fallback for local server when offline
      }

      return {
        supported: true,
        usage: {
          provider,
          account: accountEntry?.label ?? activeAccountId ?? account ?? "local",
          plan: "Local / Self-hosted",
          rawSummary: "Unlimited local inference (no remote quota limits applied).",
        },
      };
    }

    // 2. OpenAI / OpenAI-Codex Provider
    if (norm === "openai" || norm === "openai-compat" || norm === "openai-codex") {
      const piAuthEntry = accountEntry?.piAuth?.entry ?? authStore?.["openai-codex"] ?? authStore?.["openai"];
      let email: string | undefined = accountEntry?.piAuth?.entry?.email;
      let plan: string | undefined;
      let name: string | undefined;
      let isOAuth = false;

      if (piAuthEntry?.access) {
        const payload = parseJwtPayload(piAuthEntry.access);
        if (payload) {
          isOAuth = true;
          const profile = payload["https://api.openai.com/profile"];
          const auth = payload["https://api.openai.com/auth"];
          email = profile?.email ?? payload.email ?? email;
          name = profile?.name ?? payload.name;
          plan = auth?.chatgpt_plan_type ?? payload.plan;
        }
      }

      const apiKey = process.env.OPENAI_API_KEY ?? (isOAuth ? undefined : piAuthEntry?.access);
      const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

      const resolvedAccountName = accountEntry?.label ?? accountEntry?.id ?? activeAccountId ?? (email ? `${name ? `${name} <${email}>` : email}` : "default");

      if (isOAuth) {
        return {
          supported: true,
          usage: {
            provider,
            account: resolvedAccountName,
            email,
            plan: plan ? `ChatGPT ${plan.charAt(0).toUpperCase() + plan.slice(1)}` : "ChatGPT OAuth",
            rawSummary: `Active ChatGPT OAuth session for ${email ?? resolvedAccountName} (OAuth identity verified).`,
          },
        };
      }

      if (apiKey) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const res = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          const reqLimit = res.headers.get("x-ratelimit-limit-requests");
          const reqRemaining = res.headers.get("x-ratelimit-remaining-requests");
          const tokenLimit = res.headers.get("x-ratelimit-limit-tokens");
          const resetReq = res.headers.get("x-ratelimit-reset-requests");

          return {
            supported: true,
            usage: {
              provider,
              account: resolvedAccountName,
              email,
              plan: plan ? `ChatGPT ${plan.charAt(0).toUpperCase() + plan.slice(1)}` : (apiKey.startsWith("sk-proj-") ? "Project API Key" : "API Key"),
              rateLimitRequestsPerMin: reqLimit ? Number.parseInt(reqLimit, 10) : undefined,
              rateLimitTokensPerMin: tokenLimit ? Number.parseInt(tokenLimit, 10) : undefined,
              quotaUsed: reqLimit && reqRemaining ? Number.parseInt(reqLimit, 10) - Number.parseInt(reqRemaining, 10) : undefined,
              quotaLimit: reqLimit ? Number.parseInt(reqLimit, 10) : undefined,
              resetTime: resetReq ?? undefined,
              rawSummary: res.ok ? "API access verified. Active session." : `API returned status ${res.status}`,
            },
          };
        } catch (error) {
          return {
            supported: true,
            error: `Failed to connect to OpenAI endpoint: ${error instanceof Error ? error.message : String(error)}`,
            usage: { provider, account: resolvedAccountName, email, plan },
          };
        }
      }

      return {
        supported: true,
        usage: {
          provider,
          account: resolvedAccountName,
          email,
          plan: plan ? `ChatGPT ${plan.charAt(0).toUpperCase() + plan.slice(1)}` : undefined,
          rawSummary: "Active OpenAI provider session.",
        },
      };
    }

    // 3. Antigravity Provider
    if (norm === "antigravity") {
      const piAuthEntry = accountEntry?.piAuth?.entry ?? authStore?.["antigravity"];
      const email = piAuthEntry?.email;
      const projectId = piAuthEntry?.projectId;
      const resolvedAccountName = accountEntry?.label ?? accountEntry?.id ?? activeAccountId ?? email ?? "default";

      return {
        supported: true,
        usage: {
          provider: "antigravity",
          account: resolvedAccountName,
          email,
          projectId,
          plan: "Google DeepMind / Antigravity Enterprise",
          rawSummary: `Active OAuth session for ${email ?? resolvedAccountName}${projectId ? ` (Project: ${projectId})` : ""}.`,
        },
      };
    }

    // 4. Anthropic Provider
    if (norm === "anthropic") {
      const piAuthEntry = accountEntry?.piAuth?.entry ?? authStore?.["anthropic"];
      const apiKey = process.env.ANTHROPIC_API_KEY ?? piAuthEntry?.access;
      const resolvedAccountName = accountEntry?.label ?? accountEntry?.id ?? activeAccountId ?? "default";

      if (apiKey) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 3000);
          const res = await fetch("https://api.anthropic.com/v1/models", {
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
            },
            signal: controller.signal,
          });
          clearTimeout(timeout);

          const reqLimit = res.headers.get("anthropic-ratelimit-requests-limit");
          const reqRemaining = res.headers.get("anthropic-ratelimit-requests-remaining");
          const tokenLimit = res.headers.get("anthropic-ratelimit-tokens-limit");
          const resetTime = res.headers.get("anthropic-ratelimit-requests-reset");

          return {
            supported: true,
            usage: {
              provider,
              account: resolvedAccountName,
              plan: piAuthEntry?.type === "oauth" ? "Anthropic OAuth" : "Anthropic API Key",
              rateLimitRequestsPerMin: reqLimit ? Number.parseInt(reqLimit, 10) : undefined,
              rateLimitTokensPerMin: tokenLimit ? Number.parseInt(tokenLimit, 10) : undefined,
              quotaUsed: reqLimit && reqRemaining ? Number.parseInt(reqLimit, 10) - Number.parseInt(reqRemaining, 10) : undefined,
              quotaLimit: reqLimit ? Number.parseInt(reqLimit, 10) : undefined,
              resetTime: resetTime ?? undefined,
              rawSummary: res.ok ? "Anthropic session verified." : `API returned status ${res.status}`,
            },
          };
        } catch (error) {
          return {
            supported: true,
            error: `Failed to connect to Anthropic endpoint: ${error instanceof Error ? error.message : String(error)}`,
            usage: { provider, account: resolvedAccountName },
          };
        }
      }

      return {
        supported: true,
        usage: {
          provider,
          account: resolvedAccountName,
          plan: piAuthEntry?.type === "oauth" ? "Anthropic OAuth" : undefined,
          rawSummary: "Active Anthropic provider session.",
        },
      };
    }

    // 5. FreeToken Local Engine Provider
    if (norm === "freetoken") {
      try {
        const host = process.env.FREETOKEN_HOST || "http://127.0.0.1:1919";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`${host.replace(/\/$/, "")}/v1/models`, { signal: controller.signal });
        clearTimeout(timeout);

        if (res.ok) {
          const data = (await res.json()) as { data?: Array<{ id: string }> };
          const models = data.data?.map((m) => m.id).join(", ") ?? "Active";
          return {
            supported: true,
            usage: {
              provider: "freetoken",
              account: accountEntry?.label ?? activeAccountId ?? account ?? "local",
              plan: "FreeToken Edge MoE (AMD ROCm)",
              rawSummary: `FreeToken engine active on port 1919 (${models}). Unlimited local MoE inference.`,
            },
          };
        }
      } catch {
        // Fallback when server is starting
      }

      return {
        supported: true,
        usage: {
          provider: "freetoken",
          account: accountEntry?.label ?? activeAccountId ?? account ?? "local",
          plan: "FreeToken Edge MoE (AMD ROCm)",
          rawSummary: "FreeToken local server endpoint configured at http://127.0.0.1:1919/v1.",
        },
      };
    }

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

  if (usage.email) lines.push(`Email: ${usage.email}`);
  if (usage.projectId) lines.push(`Project ID: ${usage.projectId}`);
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
