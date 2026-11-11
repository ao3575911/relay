import { setTimeout as delay } from "node:timers/promises";
import { normalizeTelegramUpdate, type UpdateInbox } from "./webhook.js";

export type PollFailure = "WEBHOOK_ACTIVE" | "POLL_CONFLICT" | "BOT_UNAUTHORIZED" | "INVALID_UPDATE" | "INVALID_BATCH";
export class PollingError extends Error {
  constructor(public readonly code: PollFailure) { super(code); this.name = "PollingError"; }
}
export interface PollingApi {
  getWebhookInfo(signal?: AbortSignal): Promise<{url?:string}>;
  getUpdates(options: {offset?:number; limit:number; timeout:number; allowed_updates:("message" | "callback_query")[]}, signal?: AbortSignal): Promise<unknown[]>;
}

/** Never change or remove an existing webhook implicitly. */
export async function checkPollingAvailable(api: PollingApi, signal?: AbortSignal): Promise<void> {
  const info = await api.getWebhookInfo(signal);
  if (!info || typeof info.url !== "string") throw new PollingError("INVALID_BATCH");
  if (info.url) throw new PollingError("WEBHOOK_ACTIVE");
}

/**
 * Return the next offset only after every eligible update is durably recorded.
 * Sending that offset on the next getUpdates confirms the preceding batch.
 * Duplicates after crashes or partial persistence are handled by the inbox.
 */
export async function pollBatch(api: PollingApi, inbox: UpdateInbox, botId: string, offset?: number, signal?: AbortSignal): Promise<number | undefined> {
  if (!/^\d{1,20}$/u.test(botId) || (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0))) throw new PollingError("INVALID_BATCH");
  const updates = await api.getUpdates({ ...(offset === undefined ? {} : {offset}), limit: 100, timeout: 20, allowed_updates: ["message", "callback_query"] }, signal);
  if (!Array.isArray(updates) || updates.length > 100) throw new PollingError("INVALID_BATCH");
  let previous = offset === undefined ? -1 : offset - 1;
  const normalized = updates.map(normalizeTelegramUpdate);
  for (const update of normalized) {
    if (update.kind === "invalid") throw new PollingError("INVALID_UPDATE");
    const id = Number(update.updateId);
    if (!Number.isSafeInteger(id) || id < 0 || id >= Number.MAX_SAFE_INTEGER || id <= previous) throw new PollingError("INVALID_BATCH");
    previous = id;
  }
  for (const update of normalized) {
    if (signal?.aborted) throw signal.reason;
    if (update.kind === "accepted") await inbox.recordUpdate(botId, update.updateId, update.payload);
  }
  return updates.length ? previous + 1 : offset;
}

function fatal(error: unknown): PollingError | null {
  if (error instanceof PollingError) return error;
  if (error && typeof error === "object" && "error_code" in error) {
    if (error.error_code === 409) return new PollingError("POLL_CONFLICT");
    if (error.error_code === 401 || error.error_code === 403) return new PollingError("BOT_UNAUTHORIZED");
  }
  return null;
}
function retryDelay(error: unknown, failures: number): number {
  if (error && typeof error === "object" && "error_code" in error && error.error_code === 429 && "parameters" in error && error.parameters && typeof error.parameters === "object" && "retry_after" in error.parameters) {
    const seconds = error.parameters.retry_after;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) return Math.min(Math.ceil(seconds), 3600) * 1000;
  }
  return Math.min(1000 * 2 ** Math.min(failures - 1, 5), 30000);
}

/** Polls sequentially; retries transient failures without logging their contents. */
export async function runPolling(api: PollingApi, inbox: UpdateInbox, botId: string, signal: AbortSignal, onRetry: () => void = () => {}): Promise<void> {
  let offset: number | undefined, failures = 0;
  while (!signal.aborted) {
    try { await checkPollingAvailable(api, signal); failures = 0; break; }
    catch (error) {
      if (signal.aborted) return;
      const terminal = fatal(error); if (terminal) throw terminal;
      failures++; onRetry();
      try { await delay(retryDelay(error, failures), undefined, {signal}); }
      catch { if (signal.aborted) return; throw new PollingError("INVALID_BATCH"); }
    }
  }
  while (!signal.aborted) {
    try { offset = await pollBatch(api, inbox, botId, offset, signal); failures = 0; }
    catch (error) {
      if (signal.aborted) return;
      const terminal = fatal(error); if (terminal) throw terminal;
      failures++; onRetry();
      try { await delay(retryDelay(error, failures), undefined, {signal}); }
      catch { if (signal.aborted) return; throw new PollingError("INVALID_BATCH"); }
    }
  }
}
