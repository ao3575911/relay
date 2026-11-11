import { Api, InputFile } from "grammy";
import pg from "pg";
import { ChatGptClient } from "../../../packages/chatgpt/src/index.js";
import { RelayStore } from "../../../packages/storage/src/index.js";
import { ConfigError, loadConfig, utcDay, type RelayConfig } from "./config.js";
import { buildWebhook } from "./webhook.js";
import { dispatchOne, processOneUpdate } from "./worker.js";
import { executePendingModelRun } from "./model-run.js";
import { PollingError, runPolling, type PollingApi } from "./polling.js";
import type { TelegramDeliveryApi } from "./delivery.js";

let config: RelayConfig;
try { config = loadConfig(); }
catch (error) {
  console.error(error instanceof ConfigError ? error.message : "Relay configuration is invalid.");
  process.exit(1);
}
if (!config.allowedUserIds) console.warn("WARNING: TELEGRAM_ALLOWED_USER_IDS is unset. Every Telegram user who can message this bot will be accepted.");
if (!config.openaiApiKey) console.warn("OPENAI_API_KEY is unset. Runs stay on the scripted demo.");

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
pool.on("error", () => console.error("Relay lost an idle database connection."));
const store = new RelayStore(pool);
const model = config.openaiApiKey ? new ChatGptClient() : null;
const apiKey = config.openaiApiKey;
// Long polling waits up to 20 seconds; leave room for Telegram and network overhead.
const api = new Api(config.telegramBotToken, { timeoutSeconds: 35 });
const telegram: TelegramDeliveryApi = {
  sendMessage: (chatId, text, options) => api.sendMessage(chatId, text, options),
  editMessageText: (chatId, id, text, options) => api.editMessageText(chatId, id, text, options),
  answerCallbackQuery: (id, options) => api.answerCallbackQuery(id, options),
  sendDocument: (chatId, filename, content) => api.sendDocument(chatId, new InputFile(Buffer.from(content, "utf8"), filename)),
};
const pollingApi: PollingApi = {
  // grammY's Node types use a polyfill; both signal implementations expose the same listener contract.
  getWebhookInfo: signal => api.getWebhookInfo(signal as unknown as Parameters<typeof api.getWebhookInfo>[0]),
  getUpdates: (options, signal) => api.getUpdates(options, signal as unknown as Parameters<typeof api.getUpdates>[1]),
};
const stop = new AbortController();
let closing = false;
let timer: NodeJS.Timeout | undefined;
let activeTick: Promise<void> | undefined;
let modelJob: Promise<void> | undefined;
let polling: Promise<void> | undefined;
let app: ReturnType<typeof buildWebhook> | undefined;
let pollLock: pg.PoolClient | undefined;

function updateOptions() {
  return { allowedUserIds: config.allowedUserIds, modelConfigured: Boolean(apiKey), today: utcDay() };
}
async function cycle(): Promise<void> {
  try {
    for (let n = 0; n < 32 && await processOneUpdate(store, config.botId, updateOptions()); n++);
    let after: string | undefined;
    for (;;) {
      const owners = await store.listOwnerIds(after, 100);
      // Bound cross-owner delivery concurrency; per-owner ordering is still enforced in storage.
      for (let index = 0; index < owners.length; index += 8) {
        await Promise.all(owners.slice(index, index + 8).map(async owner => {
          try { await dispatchOne(store, owner, telegram, { modelConfigured: Boolean(apiKey) }); }
          catch { console.error("Relay could not dispatch one owner's queue; it will retry."); }
        }));
      }
      if (owners.length < 100 || closing) break;
      after = owners.at(-1);
    }
  } catch {
    // Do not log tokens, database URLs, update bodies or provider exception text.
    console.error("Relay worker could not complete a cycle; it will retry.");
  }
}
function startModel(): void {
  if (!model || !apiKey || modelJob || closing) return;
  const client = model;
  const key = apiKey;
  const job = executePendingModelRun(store, config.openaiModel, request => client.generateWithApiKey({ ...request, apiKey: key }))
    .then(() => undefined)
    .catch(() => { console.error("Relay could not finish a model run."); });
  modelJob = job.finally(() => { modelJob = undefined; });
}
function tick(): void {
  if (closing) return;
  activeTick = cycle().finally(() => {
    activeTick = undefined;
    startModel();
    if (!closing) timer = setTimeout(tick, 1000);
  });
}
function lockLost(): void {
  if (closing) return;
  console.error("Relay lost its polling lock; stopping to prevent concurrent polling.");
  process.exitCode = 1;
  void shutdown();
}
async function shutdown(): Promise<void> {
  if (closing) return;
  closing = true;
  stop.abort();
  if (timer) clearTimeout(timer);
  await polling?.catch(() => {});
  await activeTick?.catch(() => {});
  await modelJob?.catch(() => {});
  await app?.close();
  if (pollLock) {
    pollLock.off("error", lockLost);
    try { await pollLock.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [`relay:telegram-poll:${config.botId}`]); }
    catch { /* A broken connection has already released its lock. */ }
    pollLock.release(); pollLock = undefined;
  }
  await pool.end();
}
process.once("SIGTERM", () => { void shutdown(); });
process.once("SIGINT", () => { void shutdown(); });

try {
  await pool.query("SELECT 1");
  if (config.transport === "polling") {
    pollLock = await pool.connect();
    const lock = await pollLock.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired", [`relay:telegram-poll:${config.botId}`]);
    if (lock.rows[0]?.acquired !== true) throw new Error("Another Relay process is already polling this bot.");
    pollLock.on("error", lockLost);
    polling = runPolling(pollingApi, store, config.botId, stop.signal, () => console.error("Telegram polling temporarily unavailable; retrying."))
      .catch((error: unknown) => {
        if (!closing) { console.error(`Telegram polling stopped: ${error instanceof PollingError ? error.code : "CONNECTION_FAILED"}.`); process.exitCode = 1; void shutdown(); }
      });
  } else {
    app = buildWebhook(config.webhookSecret!, config.botId, store);
    await app.listen({ host: config.host, port: config.port });
  }
  tick();
} catch (error) {
  if (error instanceof ConfigError) console.error(error.message);
  else console.error("Relay could not start. Check its configuration and database connection.");
  process.exitCode = 1;
  await shutdown();
}
