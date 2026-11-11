import { pathToFileURL } from "node:url";
import { loadWebhookAdminConfig } from "../apps/bot/src/config.js";

export type WebhookCommand = "set" | "delete" | "info";
export interface WebhookAdminConfig { token: string; webhookSecret: string; publicUrl: string }
const credentialLike = /(?:sk-[a-z0-9_-]{16,}|\d{8,}:[a-z0-9_-]{20,})/ig;

function redact(value: string): string {
  return value.replace(credentialLike, "[redacted]").slice(0, 300);
}

async function callTelegram(fetcher: typeof fetch, token: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw new Error("Could not reach Telegram.");
  }
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new Error("Telegram returned an unreadable response."); }
  if (!payload || typeof payload !== "object") throw new Error("Telegram returned an unreadable response.");
  return payload as Record<string, unknown>;
}

function requireOk(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload.ok !== true) {
    const description = typeof payload.description === "string" ? redact(payload.description) : "Telegram rejected the request.";
    throw new Error(description);
  }
  const result = payload.result;
  return result && typeof result === "object" ? result as Record<string, unknown> : {};
}

/** Register, remove, or describe the bot webhook. The token and secret are not printed. */
export async function runWebhookCommand(command: WebhookCommand, config: WebhookAdminConfig, fetcher: typeof fetch = fetch): Promise<string> {
  if (command === "set") {
    const url = `${config.publicUrl}/telegram/webhook`;
    requireOk(await callTelegram(fetcher, config.token, "setWebhook", {
      url,
      secret_token: config.webhookSecret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    }));
    return `Webhook registered at ${url}.`;
  }
  if (command === "delete") {
    requireOk(await callTelegram(fetcher, config.token, "deleteWebhook", { drop_pending_updates: false }));
    return "Webhook deleted.";
  }
  if (command === "info") {
    const result = requireOk(await callTelegram(fetcher, config.token, "getWebhookInfo"));
    const url = typeof result.url === "string" && result.url ? result.url : "(none)";
    const pending = typeof result.pending_update_count === "number" ? result.pending_update_count : 0;
    const error = typeof result.last_error_message === "string" ? ` Last error: ${redact(result.last_error_message)}.` : "";
    return `Webhook URL: ${url}. Pending updates: ${pending}.${error}`;
  }
  const unexpected: never = command;
  throw new Error(`Unsupported webhook command: ${String(unexpected)}`);
}

function commandFromArgv(argv: string[]): WebhookCommand {
  const command = argv[2];
  if (command === "set" || command === "delete" || command === "info") return command;
  throw new Error("Usage: tsx scripts/telegram-webhook.ts set|delete|info");
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    const summary = await runWebhookCommand(commandFromArgv(process.argv), loadWebhookAdminConfig());
    process.stdout.write(`${summary}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Webhook command failed.");
    process.exitCode = 1;
  }
}
