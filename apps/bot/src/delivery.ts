/** Telegram delivery boundary. The worker persists outcomes separately from execution. */
export type Keyboard = { inline_keyboard: { text: string; callback_data: string }[][] };
export type Delivery =
  | { kind: "send_panel"; chatId: string; text: string }
  | { kind: "edit_panel"; chatId: string; messageId: number; text: string; plainText: string; keyboard: Keyboard }
  | { kind: "callback_ack"; callbackQueryId: string; text?: string }
  | { kind: "send_document"; chatId: string; filename: string; content: string };

export interface TelegramDeliveryApi {
  sendMessage(chatId: string, text: string, options: { parse_mode: "HTML" }): Promise<{ message_id: number }>;
  editMessageText(chatId: string, messageId: number, text: string, options: { parse_mode?: "HTML"; reply_markup: Keyboard }): Promise<unknown>;
  answerCallbackQuery(id: string, options: { text?: string }): Promise<unknown>;
  sendDocument(chatId: string, filename: string, content: string): Promise<{ message_id: number }>;
}

export type DeliveryOutcome =
  | { status: "sent"; messageId?: number }
  | { status: "retry"; delaySeconds: number; code: "RATE_LIMIT" | "TEMPORARY_FAILURE" }
  | { status: "unknown"; code: "SEND_OUTCOME_UNKNOWN" }
  | { status: "permanent"; code: "USER_BLOCKED" | "INVALID_MESSAGE" | "RETRIES_EXHAUSTED" | "INVALID_RESPONSE" };

type TelegramFailure = { error_code?: unknown; description?: unknown; parameters?: { retry_after?: unknown } };

function details(error: unknown): { code: number | null; description: string; retryAfter: number | null } {
  if (!error || typeof error !== "object") return { code: null, description: "", retryAfter: null };
  const candidate = error as TelegramFailure;
  const code = typeof candidate.error_code === "number" ? candidate.error_code : null;
  const description = typeof candidate.description === "string" ? candidate.description.toLowerCase() : "";
  const retry = candidate.parameters?.retry_after;
  const retryAfter = typeof retry === "number" && Number.isFinite(retry) && retry > 0 ? Math.min(Math.ceil(retry), 3600) : null;
  return { code, description, retryAfter };
}

/**
 * Send-panel creates only a buttonless placeholder. After a confirmed response,
 * the caller must bind each callback to the returned message ID and enqueue the
 * keyboard edit in one transaction. Uncertain sends are never retried blindly.
 */
export async function deliver(
  api: TelegramDeliveryApi,
  delivery: Delivery,
  attempts: number,
): Promise<DeliveryOutcome> {
  if (!Number.isSafeInteger(attempts) || attempts < 0) return { status: "permanent", code: "INVALID_RESPONSE" };
  try {
    if (delivery.kind === "send_panel") {
      const result = await api.sendMessage(delivery.chatId, delivery.text, { parse_mode: "HTML" });
      if (!Number.isSafeInteger(result?.message_id) || result.message_id <= 0) return { status: "unknown", code: "SEND_OUTCOME_UNKNOWN" };
      return { status: "sent", messageId: result.message_id };
    }
    if (delivery.kind === "callback_ack") {
      await api.answerCallbackQuery(delivery.callbackQueryId, delivery.text ? { text: delivery.text } : {});
      return { status: "sent" };
    }
    if (delivery.kind === "send_document") {
      const result = await api.sendDocument(delivery.chatId, delivery.filename, delivery.content);
      if (!Number.isSafeInteger(result?.message_id) || result.message_id <= 0) return { status: "unknown", code: "SEND_OUTCOME_UNKNOWN" };
      return { status: "sent", messageId: result.message_id };
    }
    try {
      await api.editMessageText(delivery.chatId, delivery.messageId, delivery.text, { parse_mode: "HTML", reply_markup: delivery.keyboard });
    } catch (error) {
      const failure = details(error);
      if (failure.code === 400 && /message is not modified/u.test(failure.description)) return { status: "sent" };
      if (failure.code === 400 && /can't parse entities|cannot parse entities/u.test(failure.description)) {
        // The supplied plain-text fallback has no Telegram HTML markup.
        await api.editMessageText(delivery.chatId, delivery.messageId, delivery.plainText, { reply_markup: delivery.keyboard });
      } else throw error;
    }
    return { status: "sent" };
  } catch (error) {
    const failure = details(error);
    if (failure.code === 403) return { status: "permanent", code: "USER_BLOCKED" };
    if (failure.code === 429 && failure.retryAfter !== null) {
      return attempts >= 3 ? { status: "permanent", code: "RETRIES_EXHAUSTED" } : { status: "retry", delaySeconds: failure.retryAfter, code: "RATE_LIMIT" };
    }
    if (failure.code === 400) return { status: "permanent", code: "INVALID_MESSAGE" };
    // Telegram may have accepted sendMessage before a timeout or 5xx. Unlike an
    // edit to a known message ID, it is unsafe to automatically send it again.
    if (delivery.kind === "send_panel" || delivery.kind === "send_document") return { status: "unknown", code: "SEND_OUTCOME_UNKNOWN" };
    if (attempts >= 3) return { status: "permanent", code: "RETRIES_EXHAUSTED" };
    return { status: "retry", delaySeconds: Math.min(2 ** attempts, 30), code: "TEMPORARY_FAILURE" };
  }
}
