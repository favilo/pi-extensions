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
    const authStore = readAuthStore();

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
              account: account ?? "local",
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
          account: account ?? "local",
          plan: "Local / Self-hosted",
          rawSummary: "Unlimited local inference (no remote quota limits applied).",
        },
      };
    }

    // 2. OpenAI / OpenAI-Codex Provider
    if (norm === "openai" || norm === "openai-compat" || norm === "openai-codex") {
      const authData = authStore?.["openai-codex"] ?? authStore?.["openai"];
      let email: string | undefined;
      let plan: string | undefined;
      let name: string | undefined;

      if (authData?.access) {
        const payload = parseJwtPayload(authData.access);
        if (payload) {
          const profile = payload["https://api.openai.com/profile"];
          const auth = payload["https://api.openai.com/auth"];
          email = profile?.email ?? payload.email;
          name = profile?.name ?? payload.name;
          plan = auth?.chatgpt_plan_type ?? payload.plan;
        }
      }

      const apiKey = process.env.OPENAI_API_KEY ?? authData?.access;
      const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";

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
              account: account && account !== "default" ? account : (email ? `${name ? `${name} <${email}>` : email}` : "default"),
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
            usage: { provider, account, email, plan },
          };
        }
      }

      return {
        supported: true,
        usage: {
          provider,
          account: account ?? email ?? "default",
          email,
          plan: plan ? `ChatGPT ${plan.charAt(0).toUpperCase() + plan.slice(1)}` : undefined,
          rawSummary: "Active OpenAI provider session.",
        },
      };
    }

    // 3. Antigravity Provider
    if (norm === "antigravity") {
      const authData = authStore?.["antigravity"];
      const email = authData?.email;
      const projectId = authData?.projectId;

      return {
        supported: true,
        usage: {
          provider: "antigravity",
          account: account && account !== "default" ? account : (email ?? "default"),
          email,
          projectId,
          plan: "Google DeepMind / Antigravity Enterprise",
          rawSummary: `Active OAuth session${projectId ? ` (Project: ${projectId})` : ""}.`,
        },
      };
    }

    // 4. Anthropic Provider
    if (norm === "anthropic") {
      const authData = authStore?.["anthropic"];
      const apiKey = process.env.ANTHROPIC_API_KEY ?? authData?.access;

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
              account: account ?? "default",
              plan: authData?.type === "oauth" ? "Anthropic OAuth" : "Anthropic API Key",
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
            usage: { provider, account },
          };
        }
      }

      return {
        supported: true,
        usage: {
          provider,
          account: account ?? "default",
          plan: authData?.type === "oauth" ? "Anthropic OAuth" : undefined,
          rawSummary: "Active Anthropic provider session.",
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
