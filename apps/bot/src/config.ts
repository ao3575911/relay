/** Startup configuration. Error text names the variable and never repeats its value. */

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

export class ConfigError extends Error {
  constructor(messages: string[]) {
    super(messages.join("\n"));
    this.name = "ConfigError";
  }
}

export interface RelayConfig {
  telegramBotToken: string;
  botId: string;
  transport: "webhook" | "polling";
  webhookSecret?: string;
  publicUrl?: string;
  allowedUserIds: ReadonlySet<string> | null;
  databaseUrl: string;
  openaiApiKey?: string;
  openaiModel: string;
  port: number;
  host: string;
  production: boolean;
}

const tokenPattern = /^\d{8,20}:[A-Za-z0-9_-]{20,}$/u;
const secretPattern = /^[A-Za-z0-9_-]{32,256}$/u;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const apiKeyPattern = /^sk-[A-Za-z0-9_-]{20,300}$/u;

function required(env: NodeJS.ProcessEnv, name: string, errors: string[]): string {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${name} is required.`);
    return "";
  }
  return value.trim();
}

/** Blank means unset. A non-blank value must be a comma-separated list of numeric Telegram user IDs. */
export function parseAllowedUserIds(value: string | undefined): { ids: Set<string> | null; error?: string } {
  if (typeof value !== "string" || !value.trim()) return { ids: null };
  const parts = value.split(",").map(part => part.trim()).filter(part => part.length > 0);
  if (!parts.length) return { ids: null, error: "TELEGRAM_ALLOWED_USER_IDS is set but contains no user IDs." };
  if (parts.length > 100) return { ids: null, error: "TELEGRAM_ALLOWED_USER_IDS accepts at most 100 user IDs." };
  if (parts.some(part => !/^[0-9]{1,20}$/u.test(part))) return { ids: null, error: "TELEGRAM_ALLOWED_USER_IDS must be comma-separated numeric Telegram user IDs." };
  return { ids: new Set(parts) };
}

export function parsePublicUrl(value: string): string | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (!url.hostname) return null;
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayConfig {
  const errors: string[] = [];
  const telegramBotToken = required(env, "TELEGRAM_BOT_TOKEN", errors);
  if (telegramBotToken && !tokenPattern.test(telegramBotToken)) errors.push("TELEGRAM_BOT_TOKEN must be a Telegram bot token.");
  const transportRaw = (env.TELEGRAM_TRANSPORT ?? "polling").trim();
  if (transportRaw !== "webhook" && transportRaw !== "polling") errors.push("TELEGRAM_TRANSPORT must be webhook or polling.");
  const transport = transportRaw === "webhook" ? "webhook" : "polling";
  const secret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (transport === "webhook" && !secret) errors.push("TELEGRAM_WEBHOOK_SECRET is required when TELEGRAM_TRANSPORT is webhook.");
  if (secret && !secretPattern.test(secret)) errors.push("TELEGRAM_WEBHOOK_SECRET must contain 32–256 characters from A–Z, a–z, 0–9, _ and -.");
  let publicUrl: string | undefined;
  if (typeof env.PUBLIC_URL === "string" && env.PUBLIC_URL.trim()) {
    const parsed = parsePublicUrl(env.PUBLIC_URL.trim());
    if (!parsed) errors.push("PUBLIC_URL must be an https origin with no path, query, or password.");
    else publicUrl = parsed;
  }
  const allow = parseAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS);
  if (allow.error) errors.push(allow.error);
  const production = (env.NODE_ENV ?? "development").trim() === "production";
  if (production && !allow.ids) errors.push("TELEGRAM_ALLOWED_USER_IDS must list at least one Telegram user ID when NODE_ENV is production.");
  const databaseUrl = required(env, "DATABASE_URL", errors);
  if (databaseUrl && !/^postgres(?:ql)?:\/\//u.test(databaseUrl)) errors.push("DATABASE_URL must be a postgres connection string.");
  if (databaseUrl.length > 2000) errors.push("DATABASE_URL is too long.");
  const openaiApiKey = env.OPENAI_API_KEY?.trim();
  if (openaiApiKey && !apiKeyPattern.test(openaiApiKey)) errors.push("OPENAI_API_KEY must be an sk- API key.");
  const openaiModel = (env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL).trim();
  if (!modelPattern.test(openaiModel)) errors.push("OPENAI_MODEL must be a model id made of letters, numbers, and . _ : -.");
  const port = Number((env.PORT ?? "3000").trim());
  if (transport === "webhook" && (!Number.isInteger(port) || port < 1 || port > 65535)) errors.push("PORT must be an integer from 1 to 65535.");
  const host = (env.HOST ?? "127.0.0.1").trim();
  if (!host || host.length > 255 || /\s/u.test(host)) errors.push("HOST must be a hostname or address without spaces.");
  if (errors.length) throw new ConfigError(errors);
  return {
    telegramBotToken,
    botId: telegramBotToken.split(":")[0]!,
    transport,
    ...(secret ? { webhookSecret: secret } : {}),
    ...(publicUrl ? { publicUrl } : {}),
    allowedUserIds: allow.ids,
    databaseUrl,
    ...(openaiApiKey ? { openaiApiKey } : {}),
    openaiModel,
    port,
    host,
    production,
  };
}

export function loadWebhookAdminConfig(env: NodeJS.ProcessEnv = process.env): { token: string; webhookSecret: string; publicUrl: string } {
  const errors: string[] = [];
  const token = required(env, "TELEGRAM_BOT_TOKEN", errors);
  if (token && !tokenPattern.test(token)) errors.push("TELEGRAM_BOT_TOKEN must be a Telegram bot token.");
  const webhookSecret = required(env, "TELEGRAM_WEBHOOK_SECRET", errors);
  if (webhookSecret && !secretPattern.test(webhookSecret)) errors.push("TELEGRAM_WEBHOOK_SECRET must contain 32–256 characters from A–Z, a–z, 0–9, _ and -.");
  const rawUrl = required(env, "PUBLIC_URL", errors);
  const publicUrl = rawUrl ? parsePublicUrl(rawUrl) : null;
  if (rawUrl && !publicUrl) errors.push("PUBLIC_URL must be an https origin with no path, query, or password.");
  if (errors.length || !publicUrl) throw new ConfigError(errors.length ? errors : ["PUBLIC_URL must be an https origin with no path, query, or password."]);
  return { token, webhookSecret, publicUrl };
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}
