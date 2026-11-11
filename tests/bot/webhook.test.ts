import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { buildWebhook, type UpdateInbox } from "../../apps/bot/src/webhook.js";

const secret = "safe_example_webhook_secret_1234567890";
const headers = { "x-telegram-bot-api-secret-token": secret };
const input = (updateId = 10) => ({
  update_id: updateId,
  message: {
    message_id: 55,
    chat: { id: 700, type: "private" },
    from: { id: 700, is_bot: false },
    text: "/start",
  },
});
const callback = (id = 11) => ({
  update_id: id,
  callback_query: {
    id: "query-1",
    from: { id: 700 },
    message: { message_id: 55, chat: { id: 700, type: "private" } },
    data: `cb:${"a".repeat(32)}`,
  },
});
function setup() {
  const saved = new Map<string, unknown>();
  const inbox: UpdateInbox = {
    async recordUpdate(botId, updateId, payload) {
      const key = `${botId}:${updateId}`;
      if (!saved.has(key)) saved.set(key, payload);
      return true;
    },
  };
  return { app: buildWebhook(secret, "12345", inbox), saved };
}

describe("Telegram private webhook", () => {
  it("rejects weak or invalid setup values", () => {
    expect(() =>
      buildWebhook("short", "12345", { recordUpdate: async () => true }),
    ).toThrow();
    expect(() =>
      buildWebhook(secret, "", { recordUpdate: async () => true }),
    ).toThrow();
  });

  it("authenticates before storing data and does not reveal details", async () => {
    const { app, saved } = setup();
    for (const header of [undefined, "wrong", `${secret}x`]) {
      const response = await app.inject({
        method: "POST",
        url: "/telegram/webhook",
        headers: header ? { "x-telegram-bot-api-secret-token": header } : {},
        payload: input(),
      });
      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain(secret);
      expect(response.body).not.toContain("/start");
    }
    expect(saved.size).toBe(0);
    await app.close();
  });

  it("persists private messages and callbacks, with duplicates safely deduplicated", async () => {
    const { app, saved } = setup();
    for (const payload of [input(), input(), callback(), callback()]) {
      const response = await app.inject({
        method: "POST",
        url: "/telegram/webhook",
        headers,
        payload,
      });
      expect(response.statusCode).toBe(200);
    }
    expect(saved.size).toBe(2);
    expect(saved.get("12345:10")).toEqual(input());
    const storedCallback = saved.get("12345:11") as {
      callback_query: { data: string };
    };
    expect(storedCallback.callback_query.data).toEqual(
      `cbh:${createHash("sha256").update(callback().callback_query.data.slice(3)).digest("hex")}`,
    );
    expect(JSON.stringify(storedCallback)).not.toContain(
      callback().callback_query.data,
    );
    await app.close();
  });

  it("removes credential-like text and unrelated metadata before durable persistence", async () => {
    const { app, saved } = setup();
    const fakeSecret = "sk-FAKE_SECRET_FOR_TEST_ONLY_123456789";
    const payload = {
      ...input(),
      relay_error: "attacker-controlled",
      message: {
        ...input().message,
        text: `Please save ${fakeSecret}`,
        caption: "unrelated user content",
      },
    };
    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers,
      payload,
    });
    expect(response.statusCode).toBe(200);
    const stored = saved.get("12345:10");
    expect(stored).toMatchObject({
      relay_error: "sensitive_input",
      message: { text: "[Sensitive input removed]" },
    });
    expect(JSON.stringify(stored)).not.toContain(fakeSecret);
    expect(JSON.stringify(stored)).not.toContain("unrelated user content");
    expect(JSON.stringify(stored)).not.toContain("attacker-controlled");
    await app.close();
  });

  it("never accepts an externally supplied callback digest", async () => {
    const { app, saved } = setup();
    const forged = callback(21);
    forged.callback_query.data = `cbh:${"a".repeat(64)}`;
    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers,
      payload: forged,
    });
    expect(response.statusCode).toBe(200);
    expect(saved.size).toBe(0);
    await app.close();
  });

  it("does not persist group, forged sender, bot, or inaccessible callbacks", async () => {
    const { app, saved } = setup();
    const group = input();
    group.message.chat.type = "group";
    const stranger = input(12);
    stranger.message.from.id = 999;
    const bot = input(13);
    bot.message.from.is_bot = true;
    const inaccessible = callback(14);
    inaccessible.callback_query.message.chat.type = "supergroup";
    for (const payload of [group, stranger, bot, inaccessible]) {
      const response = await app.inject({
        method: "POST",
        url: "/telegram/webhook",
        headers,
        payload,
      });
      expect(response.statusCode).toBe(200);
    }
    expect(saved.size).toBe(0);
    await app.close();
  });

  it("rejects malformed payloads and ignores unknown update kinds", async () => {
    const { app, saved } = setup();
    for (const payload of [
      { update_id: -1 },
      { update_id: "10" },
      { update_id: 10, message: {} },
      {
        update_id: 10,
        message: input().message,
        callback_query: callback().callback_query,
      },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/telegram/webhook",
        headers,
        payload,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/telegram/webhook",
          headers,
          payload: { update_id: 19, edited_message: {} },
        })
      ).statusCode,
    ).toBe(200);
    expect(saved.size).toBe(0);
    await app.close();
  });

  it("fails closed with retryable 503 if durable persistence fails", async () => {
    const app = buildWebhook(secret, "12345", {
      async recordUpdate() {
        throw new Error("secret database diagnostic");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers,
      payload: input(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("diagnostic");
    await app.close();
  });

  it("caps request bodies and exposes a minimal liveness check", async () => {
    const { app, saved } = setup();
    const response = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers,
      payload: { ...input(), padding: "x".repeat(262145) },
    });
    expect(response.statusCode).toBe(413);
    expect(saved.size).toBe(0);
    expect(
      (await app.inject({ method: "GET", url: "/health" })).json(),
    ).toEqual({ ok: true });
    await app.close();
  });
});
