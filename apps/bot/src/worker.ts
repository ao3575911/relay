import { render, telegramPayload, type Button, type View, type Workspace } from "../../../packages/domain/src/index.js";
import { type Json, type RelayStore } from "../../../packages/storage/src/index.js";
import { deliver, type Delivery, type TelegramDeliveryApi } from "./delivery.js";
import { handleUpdate, resolveActor, type UpdateOptions } from "./controller.js";

type Row = Record<string, Json>;
type Session = { workspace: Workspace; panelMessageId: string | null };
function object(value: Json): Row | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null; }
function messageId(value: Json | undefined): value is string { return typeof value === "string" && /^[0-9]{1,20}$/.test(value); }

/** The inbox handler and all its state changes share the same transaction. */
export async function processOneUpdate(store: RelayStore, botId: string, options?: UpdateOptions): Promise<boolean> {
  return (await store.processNextUpdate(botId, resolveActor, (payload, tx, updateId) => handleUpdate(payload, tx, updateId, options))).processed;
}

/** Deliver a single owner's queued message. Token plaintext is never persisted. */
export async function dispatchOne(store: RelayStore, ownerId: string, api: TelegramDeliveryApi, options?: { modelConfigured?: boolean }): Promise<boolean> {
  const item = await store.withOwner(ownerId, tx => tx.claimNextOutbox());
  if (!item) return false;
  const payload = object(item.payload);
  const fail = async (code: string) => { await store.withOwner(ownerId, tx => tx.failOutbox(item.id, item.leaseId, code)); };
  if (!payload || typeof payload.kind !== "string") { await fail("INVALID_PAYLOAD"); return true; }
  let delivery: Delivery;
  if (payload.kind === "callback_ack" && typeof payload.callbackQueryId === "string") {
    delivery = { kind: "callback_ack", callbackQueryId: payload.callbackQueryId, ...(typeof payload.text === "string" ? { text: payload.text } : {}) };
  } else if (payload.kind === "send_panel_view" && messageId(payload.chatId) && typeof payload.revision === "number") {
    delivery = { kind: "send_panel", chatId: payload.chatId, text: "<b>Relay</b>\n\nOpening your workspace…" };
  } else if (payload.kind === "send_notice" && messageId(payload.chatId) && typeof payload.text === "string" && payload.text.length > 0 && payload.text.length <= 500 && !/<|>|&/u.test(payload.text)) {
    delivery = { kind: "send_panel", chatId: payload.chatId, text: payload.text };
  } else if (payload.kind === "send_document" && messageId(payload.chatId) && typeof payload.filename === "string" && /^relay-h_[a-z0-9]{1,32}\.json$/.test(payload.filename) && typeof payload.content === "string" && payload.content.length <= 16000) {
    delivery = { kind: "send_document", chatId: payload.chatId, filename: payload.filename, content: payload.content };
  } else if (payload.kind === "edit_panel_view" && messageId(payload.chatId) && messageId(payload.messageId) && typeof payload.revision === "number") {
    const prepared = await store.withOwner(ownerId, async tx => {
      const row = await tx.getWorkspace();
      const saved = row?.state as unknown as Session | undefined;
      if (!row || !saved || saved.workspace?.ownerId !== ownerId || row.revision !== payload.revision || saved.workspace.revision !== row.revision || saved.panelMessageId !== payload.messageId) {
        await tx.ackOutbox(item.id, item.leaseId); return null;
      }
      const canonical = render(saved.workspace, ownerId, { modelConfigured: options?.modelConfigured === true });
      const supplied = object(payload.view ?? null);
      const paragraphs = supplied && Array.isArray(supplied.paragraphs) && supplied.paragraphs.every(x => typeof x === "string") ? supplied.paragraphs as string[] : canonical.paragraphs;
      // Actions always come from the current server-rendered state, never job input.
      const view: View = { ...canonical, paragraphs };
      const tokens: string[] = [];
      for (const row of view.rows) for (const button of row) tokens.push(await tx.createCallback({ chatId: payload.chatId as string, messageId: payload.messageId as string, action: button.action, resourceId: saved.workspace.selectedId ?? saved.workspace.draft?.config.id ?? null, revision: rowRevision(saved), payload: { value: button.value }, expiresAt: new Date(Date.now() + 14 * 60 * 1000) }));
      let index = 0;
      const wire = telegramPayload(view, (_button: Button) => tokens[index++]!);
      return { kind: "edit_panel" as const, chatId: payload.chatId as string, messageId: Number(payload.messageId), text: wire.text, plainText: [view.title, ...view.paragraphs].join("\n\n"), keyboard: wire.reply_markup };
    });
    if (!prepared) return true;
    delivery = prepared;
  } else { await fail("INVALID_PAYLOAD"); return true; }

  const result = await deliver(api, delivery, item.attempts);
  await store.withOwner(ownerId, async tx => {
    if (result.status === "sent") {
      // Acknowledgement and the follow-up edit intent are one transaction.
      const acknowledged = await tx.ackOutbox(item.id, item.leaseId, result.messageId ? String(result.messageId) : null);
      if (!acknowledged) return;
      if (payload.kind === "send_panel_view" && result.messageId) {
        const row = await tx.getWorkspace(); const saved = row?.state as unknown as Session | undefined;
        if (!row || !saved || saved.workspace?.ownerId !== ownerId || row.revision !== payload.revision || saved.panelMessageId !== null) return;
        saved.panelMessageId = String(result.messageId); saved.workspace.revision++;
        const revision = await tx.saveWorkspace(saved as unknown as Json, row.revision);
        if (revision !== saved.workspace.revision) throw new Error("Workspace revision mismatch.");
        await tx.enqueueOutbox(`panel:${item.id}:ready`, { kind: "edit_panel_view", chatId: payload.chatId!, messageId: saved.panelMessageId, revision, view: payload.view ?? null });
      }
    } else if (result.status === "retry") await tx.rescheduleOutbox(item.id, item.leaseId, result.delaySeconds);
    else if (result.status === "unknown") await tx.markOutboxUnknown(item.id, item.leaseId);
    else await tx.failOutbox(item.id, item.leaseId, result.code);
  });
  return true;
}

function rowRevision(session: Session): number { return session.workspace.revision; }
