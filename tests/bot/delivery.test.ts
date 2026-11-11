import { describe, expect, it, vi } from "vitest";
import { deliver, type TelegramDeliveryApi, type Delivery } from "../../apps/bot/src/delivery.js";

function api(): TelegramDeliveryApi {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    answerCallbackQuery: vi.fn().mockResolvedValue(true),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 43 }),
  };
}
const panel: Delivery = { kind: "send_panel", chatId: "123", text: "<b>Welcome</b>" };
const edit: Delivery = { kind: "edit_panel", chatId: "123", messageId: 42, text: "<b>Menu</b>", plainText: "Menu", keyboard: { inline_keyboard: [[{ text: "Home", callback_data: "cb:token" }]] } };

describe("Telegram delivery safety", () => {
  it("sends a buttonless placeholder and exposes the real message ID for token binding", async () => {
    const client = api();
    expect(await deliver(client, panel, 0)).toEqual({ status: "sent", messageId: 42 });
    expect(client.sendMessage).toHaveBeenCalledWith("123", "<b>Welcome</b>", { parse_mode: "HTML" });
  });
  it("never blindly retries an ambiguous placeholder send", async () => {
    const client = api(); vi.mocked(client.sendMessage).mockRejectedValue(new Error("connection reset"));
    expect(await deliver(client, panel, 0)).toEqual({ status: "unknown", code: "SEND_OUTCOME_UNKNOWN" });
    expect(client.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("honours Telegram rate limits and bounds retries", async () => {
    const client = api(); vi.mocked(client.sendMessage).mockRejectedValue({ error_code: 429, parameters: { retry_after: 7 } });
    expect(await deliver(client, panel, 0)).toEqual({ status: "retry", code: "RATE_LIMIT", delaySeconds: 7 });
    expect(await deliver(client, panel, 3)).toEqual({ status: "permanent", code: "RETRIES_EXHAUSTED" });
  });
  it("edits a known message idempotently and accepts an unchanged result", async () => {
    const client = api(); vi.mocked(client.editMessageText).mockRejectedValue({ error_code: 400, description: "Bad Request: message is not modified" });
    expect(await deliver(client, edit, 0)).toEqual({ status: "sent" });
  });
  it("falls back to plain text on a formatting error without repeating a task", async () => {
    const client = api(); vi.mocked(client.editMessageText).mockRejectedValueOnce({ error_code: 400, description: "Bad Request: can't parse entities" }).mockResolvedValueOnce(true);
    expect(await deliver(client, edit, 0)).toEqual({ status: "sent" });
    expect(client.editMessageText).toHaveBeenNthCalledWith(2, "123", 42, "Menu", { reply_markup: edit.keyboard });
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
  it("returns a permanent blocked-user error without leaking the exception", async () => {
    const client = api(); vi.mocked(client.editMessageText).mockRejectedValue({ error_code: 403, description: "private raw details" });
    expect(await deliver(client, edit, 0)).toEqual({ status: "permanent", code: "USER_BLOCKED" });
  });
  it("acknowledges callback queries and retries only safe temporary failures", async () => {
    const client = api(); vi.mocked(client.answerCallbackQuery).mockRejectedValueOnce(new Error("network"));
    const ack: Delivery = { kind: "callback_ack", callbackQueryId: "q1" };
    expect(await deliver(client, ack, 0)).toEqual({ status: "retry", code: "TEMPORARY_FAILURE", delaySeconds: 1 });
    expect(await deliver(client, ack, 1)).toEqual({ status: "sent" });
  });
});
