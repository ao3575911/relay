import { ChatGptError, type ChatGptErrorCode } from "../../../packages/chatgpt/src/index.js";
import { claimNextModelRun, settleModelRun, type ModelFailureCode, type Workspace } from "../../../packages/domain/src/index.js";
import type { Json, RelayStore } from "../../../packages/storage/src/index.js";

interface Session { workspace: Workspace; panelMessageId: string | null }
type Generate = (request: { model: string; task: string; instructions: string; timeoutMs: number; maxOutputTokens: number }) => Promise<string>;

function session(value: Json): Session | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as unknown as Session;
  if (!candidate.workspace || typeof candidate.workspace !== "object" || candidate.workspace.ownerId === undefined) return null;
  if (!(candidate.panelMessageId === null || (typeof candidate.panelMessageId === "string" && /^\d+$/u.test(candidate.panelMessageId)))) return null;
  return candidate;
}

function failureCode(error: unknown): ModelFailureCode {
  if (!(error instanceof ChatGptError)) return "FAILED";
  switch (error.code) {
    case "TIMEOUT": return "TIMEOUT";
    case "CANCELLED": return "CANCELLED";
    case "LIMIT_REACHED": return "LIMIT_REACHED";
    case "UNAVAILABLE": return "UNAVAILABLE";
    case "NETWORK": return "NETWORK";
    case "INVALID_REQUEST":
    case "AUTH_REQUIRED":
    case "ACCESS_DENIED":
      return "INVALID_REQUEST";
    case "OUTPUT_TOO_LARGE": return "OUTPUT_TOO_LARGE";
    case "STREAM_INTERRUPTED":
    case "PROVIDER_ERROR":
      return "FAILED";
    default: {
      const unexpected: never = error.code;
      throw new Error(`Unsupported model error: ${unexpected as ChatGptErrorCode}`);
    }
  }
}

async function publish(store: RelayStore, ownerId: string, chatId: string, panelMessageId: string | null, revision: number, runId: string): Promise<void> {
  const payload: Json = panelMessageId
    ? { kind: "edit_panel_view", chatId, messageId: panelMessageId, revision, view: null }
    : { kind: "send_panel_view", chatId, revision, view: null };
  await store.withOwner(ownerId, tx => tx.enqueueOutbox(`model:${runId}:done`, payload));
}

/**
 * Claim one pending model run, call the provider outside a database transaction,
 * and store a redacted outcome. A failed or stale claim is not sent again.
 */
export async function executePendingModelRun(store: RelayStore, model: string, generate: Generate, nowMs = Date.now()): Promise<"idle" | "settled"> {
  let after: string | undefined;
  for (;;) {
  const owners = await store.listOwnerIds(after, 100);
  for (const ownerId of owners) {
    const claimed = await store.withOwner(ownerId, async tx => {
      const row = await tx.getWorkspace();
      const saved = row ? session(row.state) : null;
      if (!row || !saved || saved.workspace.ownerId !== ownerId) return null;
      const phase = claimNextModelRun(saved.workspace, ownerId, nowMs);
      if (phase.type === "idle") return null;
      const revision = await tx.saveWorkspace({ workspace: phase.state as unknown as Json, panelMessageId: saved.panelMessageId }, row.revision);
      if (revision !== phase.state.revision) throw new Error("Workspace revision mismatch.");
      return { phase, panelMessageId: saved.panelMessageId, revision };
    });
    if (!claimed) continue;
    const chatId = await store.getPrivateChatId(ownerId);
    if (claimed.phase.type === "expired") {
      if (chatId) await publish(store, ownerId, chatId, claimed.panelMessageId, claimed.revision, claimed.phase.runId);
      return "settled";
    }
    const run = claimed.phase.run;
    let settlement: { status: "complete"; output: string } | { status: "failed"; code: ModelFailureCode };
    try {
      const output = await generate({ model, task: run.task, instructions: run.instructions, timeoutMs: run.timeoutMs, maxOutputTokens: run.maxOutputTokens });
      settlement = { status: "complete", output };
    } catch (error) {
      const code = failureCode(error);
      console.error(`Relay model run failed (${code}).`);
      settlement = { status: "failed", code };
    }
    const saved = await store.withOwner(ownerId, async tx => {
      const row = await tx.getWorkspace();
      const current = row ? session(row.state) : null;
      if (!row || !current) return null;
      const next = settleModelRun(current.workspace, ownerId, run.id, settlement);
      if (!next) return null;
      const revision = await tx.saveWorkspace({ workspace: next as unknown as Json, panelMessageId: current.panelMessageId }, row.revision);
      if (revision !== next.revision) throw new Error("Workspace revision mismatch.");
      return { revision, panelMessageId: current.panelMessageId };
    });
    if (saved && chatId) await publish(store, ownerId, chatId, saved.panelMessageId, saved.revision, run.id);
    return "settled";
  }
  if (owners.length < 100) return "idle";
  after = owners.at(-1);
  }
}
