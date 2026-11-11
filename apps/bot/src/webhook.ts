import { createHash, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

/** Only a successful durable inbox insert permits an HTTP 200. */
export interface UpdateInbox {
  recordUpdate(
    botId: string,
    updateId: string,
    payload: unknown,
  ): Promise<unknown>;
}

const identifier = z.number().int().safe().positive();
const user = z
  .object({ id: identifier, is_bot: z.boolean().optional() })
  .passthrough();
const chat = z
  .object({ id: z.number().int().safe(), type: z.string().max(40) })
  .passthrough();
const message = z
  .object({
    message_id: identifier,
    chat,
    from: user.optional(),
    text: z.string().max(4096).optional(),
  })
  .passthrough();
const callback = z
  .object({
    id: z.string().min(1).max(256),
    from: user,
    message: z
      .object({ message_id: identifier, chat })
      .passthrough()
      .optional(),
    data: z.string().optional(),
  })
  .passthrough();
const envelope = z
  .object({
    update_id: z.number().int().safe().nonnegative(),
    message: z.unknown().optional(),
    callback_query: z.unknown().optional(),
  })
  .passthrough();
const credentialLike = /(?:sk-[a-z0-9_-]{16,}|\d{8,}:[a-z0-9_-]{20,})/i;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export type NormalizedUpdate =
  | { kind: "accepted"; updateId: string; payload: Record<string, unknown> }
  | { kind: "ignored"; updateId: string }
  | { kind: "invalid" };

/** Shared ingress rules for webhooks and long polling; never persist raw updates. */
export function normalizeTelegramUpdate(body: unknown): NormalizedUpdate {
  const parsed = envelope.safeParse(body);
  if (!parsed.success) return { kind: "invalid" };
  const update = parsed.data;
  const updateId = String(update.update_id);
  if (update.message !== undefined && update.callback_query !== undefined) return { kind: "invalid" };

  let safeUpdate: Record<string, unknown>;
  if (update.message !== undefined) {
    const result = message.safeParse(update.message);
    if (!result.success) return { kind: "invalid" };
    const value = result.data;
    if (value.chat.type !== "private" || !value.from || value.from.is_bot || value.chat.id !== value.from.id || !value.text?.trim()) return { kind: "ignored", updateId };
    const sensitive = credentialLike.test(value.text);
    safeUpdate = {
      update_id: update.update_id,
      ...(sensitive ? { relay_error: "sensitive_input" } : {}),
      message: {
        message_id: value.message_id,
        chat: { id: value.chat.id, type: "private" },
        from: { id: value.from.id, is_bot: false },
        text: sensitive ? "[Sensitive input removed]" : value.text,
      },
    };
  } else if (update.callback_query !== undefined) {
    const result = callback.safeParse(update.callback_query);
    if (!result.success) return { kind: "invalid" };
    const value = result.data;
    if (!value.message || value.message.chat.type !== "private" || value.from.is_bot || value.message.chat.id !== value.from.id || !value.data || !/^cb:[A-Za-z0-9_-]{32}$/.test(value.data)) return { kind: "ignored", updateId };
    safeUpdate = {
      update_id: update.update_id,
      callback_query: {
        id: value.id,
        from: { id: value.from.id, is_bot: false },
        message: { message_id: value.message.message_id, chat: { id: value.message.chat.id, type: "private" } },
        data: `cbh:${digest(value.data.slice(3)).toString("hex")}`,
      },
    };
  } else return { kind: "ignored", updateId };
  return { kind: "accepted", updateId, payload: safeUpdate };
}

/**
 * Create a standalone webhook server without starting a listener.
 * `secret` is the independently generated setWebhook secret, not the bot token.
 * The inbox must deduplicate (botId, updateId) durably and be shared by workers.
 */
export function buildWebhook(
  secret: string,
  botId: string,
  inbox: UpdateInbox,
): FastifyInstance {
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
    throw new Error(
      "Webhook secret must contain 32–256 Telegram-compatible characters.",
    );
  }
  if (!/^\d{1,20}$/.test(botId))
    throw new Error("A numeric bot ID is required.");
  const expectedSecretDigest = digest(secret);
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });

  // Never include request bodies, headers, callback tokens, or exception details.
  app.setErrorHandler((error, _request, reply) => {
    const code =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : undefined;
    const status = code === 413 ? 413 : code === 415 ? 415 : 400;
    void reply.code(status).send({ ok: false, error: "Invalid request." });
  });

  app.get("/health", async () => ({ ok: true }));

  app.post("/telegram/webhook", async (request, reply) => {
    const supplied = request.headers["x-telegram-bot-api-secret-token"];
    const candidate = typeof supplied === "string" ? supplied : "";
    if (!timingSafeEqual(expectedSecretDigest, digest(candidate))) {
      return reply.code(401).send({ ok: false, error: "Unauthorized." });
    }

    const update = normalizeTelegramUpdate(request.body);
    if (update.kind === "invalid") return reply.code(400).send({ ok: false, error: "Invalid update." });
    if (update.kind === "ignored") return reply.code(200).send({ ok: true });

    try {
      await inbox.recordUpdate(botId, update.updateId, update.payload);
    } catch {
      // Telegram may retry: no state or side effect is assumed to have happened.
      return reply
        .code(503)
        .send({ ok: false, error: "Temporarily unavailable." });
    }
    return reply.code(200).send({ ok: true });
  });
  return app;
}
