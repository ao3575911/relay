import { describe, expect, it, vi } from "vitest";
import { runWebhookCommand } from "../../scripts/telegram-webhook.js";

const config = {
  token: "123456789:AAHexampleTokenValueXXXX",
  webhookSecret: "a".repeat(40),
  publicUrl: "https://bot.example.com",
};

function json(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}

describe("Telegram webhook registration", () => {
  it("registers the webhook with the secret and does not print the token", async () => {
    const fetcher = vi.fn(async () => json({ ok: true, result: true })) as unknown as typeof fetch;
    const summary = await runWebhookCommand("set", config, fetcher);
    expect(summary).toBe("Webhook registered at https://bot.example.com/telegram/webhook.");
    expect(summary).not.toContain(config.token);
    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(String(url)).toBe(`https://api.telegram.org/bot${config.token}/setWebhook`);
    expect(JSON.parse(String(init?.body))).toEqual({
      url: "https://bot.example.com/telegram/webhook",
      secret_token: config.webhookSecret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    });
  });
  it("deletes and describes a webhook without repeating provider secrets", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    vi.mocked(fetcher).mockResolvedValueOnce(json({ ok: true, result: true }));
    expect(await runWebhookCommand("delete", config, fetcher)).toBe("Webhook deleted.");
    vi.mocked(fetcher).mockResolvedValueOnce(json({ ok: true, result: { url: "https://bot.example.com/telegram/webhook", pending_update_count: 2, last_error_message: `bad ${config.token}` } }));
    const info = await runWebhookCommand("info", config, fetcher);
    expect(info).toContain("Pending updates: 2");
    expect(info).not.toContain(config.token);
    expect(info).toContain("[redacted]");
  });
});
