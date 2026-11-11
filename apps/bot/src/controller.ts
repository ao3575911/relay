import { randomBytes } from "node:crypto";
import { createWorkspace, render, transition, validateConfig, type Effect, type HarnessConfig, type View, type Workspace } from "../../../packages/domain/src/index.js";
import { canonicalJson } from "../../../packages/storage/src/index.js";

/** Narrow transaction contract: implementation must be owner-scoped and atomic. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface DraftRecord { harnessId: string; baseVersion: number; revision: number; config: Json }
export interface ControllerTransaction {
  ownerId: string;
  getWorkspace(): Promise<{ state: Json; revision: number } | null>;
  getHarness(harnessId: string): Promise<{ownerId: string; harnessId: string; activeVersion: number; paused: boolean; config: Json} | null>;
  saveWorkspace(state: Json, expectedRevision: number): Promise<number>;
  getDraft(): Promise<DraftRecord | null>;
  saveDraft(harnessId: string, baseVersion: number, config: unknown, cursor: string, revision: number): Promise<unknown>;
  commitDraft(harnessId: string, baseVersion: number, revision: number): Promise<unknown>;
  discardDraft(harnessId: string, revision: number): Promise<void>;
  setPaused(harnessId: string, paused: boolean): Promise<unknown>;
  restoreVersion(harnessId: string, version: number, expectedActiveVersion: number): Promise<unknown>;
  consumeCallbackHash(hash: string, binding: { chatId: string; messageId: string; revision: number }): Promise<{action: string; resourceId: string | null; payload: Json} | null>;
  enqueueOutbox(dedupKey: string, payload: Json): Promise<boolean>;
}
interface StoredWorkspace { workspace: Workspace; panelMessageId: string | null }
interface MessageUpdate { update_id: number; message: { from: { id: number }; chat: { id: number }; text: string }; relay_error?: string }
interface CallbackUpdate { update_id: number; callback_query: { id: string; from: { id: number }; message: { message_id: number; chat: { id: number } }; data: string } }
type Update = MessageUpdate | CallbackUpdate;

/** Extract the owner only after the ingress adapter authenticated and normalized the update. */
export function resolveActor(payload: Json): { telegramUserId: string; chatId: string } | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const update = payload as unknown as Update;
  const part = "message" in update ? update.message : "callback_query" in update ? update.callback_query : null;
  if (!part || !part.from || !Number.isSafeInteger(part.from.id) || part.from.id <= 0) return null;
  const chatId = "chat" in part ? part.chat.id : part.message?.chat.id;
  if (!Number.isSafeInteger(chatId) || chatId !== part.from.id) return null;
  return { telegramUserId: String(part.from.id), chatId: String(chatId) };
}

function unpack(stored: {state: Json; revision: number} | null, ownerId: string): StoredWorkspace {
  if (!stored) return { workspace: createWorkspace(ownerId), panelMessageId: null };
  const value = stored.state as unknown as StoredWorkspace;
  if (!value || typeof value !== "object" || !value.workspace || value.workspace.ownerId !== ownerId || value.workspace.revision !== stored.revision || !(value.panelMessageId === null || /^\d+$/.test(value.panelMessageId))) throw new Error("Stored workspace is invalid.");
  // render is owner-checked and rejects inconsistent state; fail closed instead of reconstructing grants.
  render(value.workspace, ownerId);
  return value;
}

async function applyEffects(tx: ControllerTransaction, effects: Effect[], chatId: string, updateId: string): Promise<void> {
  let draft = await tx.getDraft();
  let committed = false;
  for (const effect of effects) {
    if (effect.ownerId !== tx.ownerId) throw new Error("Owner mismatch.");
    switch (effect.type) {
      case "save_draft":
        await tx.saveDraft(effect.draft.config.id, effect.draft.baseVersion ?? 0, effect.draft.config, effect.draft.cursor, draft?.revision ?? 0);
        draft = await tx.getDraft();
        break;
      case "create_harness":
      case "commit_draft": {
        const id = effect.type === "create_harness" ? effect.config.id : effect.harnessId;
        const base = effect.type === "create_harness" ? 0 : effect.baseVersion;
        if (!draft || draft.harnessId !== id || draft.baseVersion !== base || validateConfig(effect.config).length || canonicalJson(draft.config) !== canonicalJson(effect.config)) throw new Error("Draft changed before commit.");
        await tx.commitDraft(id, base, draft.revision); draft = null; committed = true;
        break;
      }
      case "discard_draft":
        if (!committed) {
          if (!draft) throw new Error("Draft unavailable.");
          await tx.discardDraft(draft.harnessId, draft.revision); draft = null;
        }
        break;
      case "set_paused": await tx.setPaused(effect.harnessId, effect.paused); break;
      case "restore_version": await tx.restoreVersion(effect.harnessId, effect.restoredVersion, effect.baseVersion); break;
      case "verify_demo": break; // Checked against the authoritative record before applying any effects.
      case "export_config":
        if (validateConfig(effect.config).length) throw new Error("Invalid export.");
        await tx.enqueueOutbox(`update:${updateId}:export`, { kind: "send_document", chatId, filename: `relay-${effect.harnessId}.json`, content: `${JSON.stringify(effect.config, null, 2)}\n` });
        break;
      default: {
        const unexpected: never = effect;
        throw new Error(`Unsupported effect: ${(unexpected as Effect).type}`);
      }
    }
  }
}

export interface UpdateOptions {
  /** When set, every other Telegram user is refused before any workspace change. */
  allowedUserIds?: ReadonlySet<string> | null;
  /** When true, a confirmed demo calls the model instead of recording a scripted example. */
  modelConfigured?: boolean;
  /** UTC day, YYYY-MM-DD, used to reserve the daily budget. */
  today?: string;
}
export const ACCESS_REFUSAL = "Relay is not open to this Telegram account. Ask the operator if you need access.";

function viewJson(view: View, notice?: string): Json {
  return { title: view.title, paragraphs: notice ? [notice, ...view.paragraphs] : view.paragraphs, rows: view.rows.map(row => row.map(b => ({ label: b.label, action: b.action, value: b.value }))) };
}

/**
 * Process one normalized update inside the same DB transaction that locks the
 * inbox row. Only semantic view descriptors enter the outbox: raw callbacks
 * are minted just before delivery and never stored there.
 */
export async function handleUpdate(payload: Json, tx: ControllerTransaction, updateId: string, options: UpdateOptions = {}): Promise<void> {
  const actor = resolveActor(payload);
  if (!actor) return;
  if (options.allowedUserIds && !options.allowedUserIds.has(actor.telegramUserId)) {
    await tx.enqueueOutbox(`update:${updateId}:refusal`, { kind: "send_notice", chatId: actor.chatId, text: ACCESS_REFUSAL });
    return;
  }
  const update = payload as unknown as Update;
  const current = unpack(await tx.getWorkspace(), tx.ownerId);
  const before = current.workspace.revision;
  let notice: string | undefined;
  let event: Parameters<typeof transition>[3] | undefined;
  if ("callback_query" in update) {
    const query = update.callback_query;
    if (!/^cbh:[a-f0-9]{64}$/.test(query.data)) return;
    const binding = { chatId: actor.chatId, messageId: String(query.message.message_id), revision: before };
    const action = await tx.consumeCallbackHash(query.data.slice(4), binding);
    if (!action) notice = "That button is out of date. Open the latest menu.";
    else {
      const value = action.payload && typeof action.payload === "object" && !Array.isArray(action.payload) && typeof action.payload.value === "string" ? action.payload.value : "";
      event = { type: "button", action: action.action, value, ...(action.action === "create" ? { newHarnessId: `h_${randomBytes(12).toString("hex")}` } : {}), ...(action.action === "demo_start" ? { newDemoRunId: `r_${randomBytes(12).toString("hex")}` } : {}), ...(action.action === "demo_start" && options.modelConfigured ? { modelRun: { day: options.today ?? "" } } : {}) };
    }
    await tx.enqueueOutbox(`update:${updateId}:ack`, { kind: "callback_ack", callbackQueryId: query.id, ...(notice ? { text: notice } : {}) });
  } else if (update.relay_error === "sensitive_input") {
    notice = "That looks like a credential. It was not saved. Use the secure setup flow instead.";
  } else if (update.message.text === "/start" || update.message.text === "/cancel" || update.message.text === "/help") {
    event = { type: "command", command: update.message.text };
  } else {
    event = { type: "text", text: update.message.text };
  }
  let next = current.workspace;
  if (event) {
    const result = transition(next, tx.ownerId, before, event);
    if (result.ok) {
      const verify = result.effects.find(effect => effect.type === "verify_demo");
      const saved = verify ? await tx.getHarness(verify.harnessId) : null;
      const validSaved = !!verify && !!saved && saved.ownerId === tx.ownerId && saved.harnessId === verify.harnessId && validateConfig(saved.config).length === 0 && (saved.config as {id?: unknown}).id === verify.harnessId;
      const demoMatches = !verify || (validSaved && !saved!.paused && saved!.activeVersion === verify.baseVersion && canonicalJson(saved!.config) === canonicalJson(verify.config));
      if (!demoMatches && verify) {
        // Refresh the visible snapshot when possible; never record a demo from stale state.
        next = structuredClone(current.workspace);
        const cached = next.harnesses.find(h => h.id === verify.harnessId && h.ownerId === tx.ownerId);
        if (cached && validSaved && saved) {
          cached.paused = saved.paused; cached.activeVersion = saved.activeVersion;
          cached.versions = [...cached.versions.filter(v => v.version !== saved.activeVersion), { version: saved.activeVersion, config: structuredClone(saved.config) as unknown as HarnessConfig }].sort((a, b) => a.version - b.version);
        } else next.harnesses = next.harnesses.filter(h => h.id !== verify.harnessId);
        next.selectedId = null; next.demoTask = null; next.screen = "home"; next.revision = before + 1;
        notice = "The harness changed or is unavailable. Open it again to review its current status.";
      } else { await applyEffects(tx, result.effects, actor.chatId, updateId); next = result.state; notice = result.notice ?? notice; }
    }
    else notice = result.message;
  }
  if (next === current.workspace) next = { ...next, revision: before + 1 };
  const revision = await tx.saveWorkspace({ workspace: next as unknown as Json, panelMessageId: current.panelMessageId }, before);
  if (revision !== next.revision) throw new Error("Workspace revision mismatch.");
  const view = viewJson(render(next, tx.ownerId, { modelConfigured: options.modelConfigured === true }), notice);
  const panel = current.panelMessageId
    ? { kind: "edit_panel_view", chatId: actor.chatId, messageId: current.panelMessageId, revision, view }
    : { kind: "send_panel_view", chatId: actor.chatId, revision, view };
  await tx.enqueueOutbox(`update:${updateId}:panel`, panel as Json);
}
