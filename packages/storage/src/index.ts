import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { validateConfig } from "../../domain/src/index.js";

export type StoreErrorCode = "INVALID_INPUT" | "NOT_FOUND" | "VERSION_CONFLICT" | "DRAFT_CONFLICT" | "DRAFT_EXISTS" | "AUTH_DENIED";
export class StoreError extends Error {
  constructor(public readonly code: StoreErrorCode) { super(code); this.name = "StoreError"; }
}
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Harness { ownerId: string; harnessId: string; activeVersion: number; paused: boolean; config: Json; configHash: string }
export interface Draft { ownerId: string; harnessId: string; baseVersion: number; config: Json; cursor: string; revision: number; expiresAt: Date }
export interface CallbackInput { chatId: string; messageId: string; action: string; resourceId: string | null; revision: number; payload: Json; expiresAt: Date }
export interface CallbackBinding { chatId: string; messageId: string; revision: number }
export interface CallbackAction { action: string; resourceId: string | null; payload: Json }
export interface OutboxItem { id: string; leaseId: string; dedupKey: string; payload: Json; attempts: number }
export interface Actor { telegramUserId: string; chatId: string }

const digits = (value: string): boolean => typeof value === "string" && /^[0-9]{1,20}$/.test(value);
const harnessIdValid = (value: string): boolean => typeof value === "string" && /^h_[a-z0-9]{1,32}$/.test(value);
const revisionValid = (value: number): boolean => Number.isSafeInteger(value) && value >= 0 && value <= 2147483646;
const uuidValid = (value: string): boolean => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function requireValid(condition: unknown): asserts condition { if (!condition) throw new StoreError("INVALID_INPUT"); }

/** Stable JSON for content hashes. Rejects non-JSON values rather than coercing them. */
export function canonicalJson(value: unknown): string {
  const seen = new Set<object>();
  function visit(item: unknown, depth = 0): string {
    requireValid(depth <= 32);
    if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number") { requireValid(Number.isFinite(item)); return JSON.stringify(item); }
    requireValid(typeof item === "object");
    requireValid(!seen.has(item)); seen.add(item);
    let result: string;
    if (Array.isArray(item)) { requireValid(item.length <= 1000); result = `[${item.map((child) => visit(child, depth + 1)).join(",")}]`; }
    else {
      requireValid(Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null);
      const record = item as Record<string, unknown>;
      requireValid(Object.keys(record).length <= 1000);
      result = `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${visit(record[key], depth + 1)}`).join(",")}}`;
    }
    seen.delete(item);
    return result;
  }
  const result = visit(value);
  requireValid(Buffer.byteLength(result, "utf8") <= 262144);
  return result;
}
const digest = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");
function configJson(config: unknown, harnessId: string): string {
  requireValid(config !== null && typeof config === "object" && !Array.isArray(config) && (config as Record<string, unknown>).id === harnessId);
  const result = canonicalJson(config); requireValid(Buffer.byteLength(result, "utf8") <= 65536); requireValid(validateConfig(config).length === 0); return result;
}
type HarnessRow = { owner_id: string; harness_id: string; active_version: number; paused: boolean; config: Json; config_hash: string };
type DraftRow = { owner_id: string; harness_id: string; base_version: number; config: Json; cursor: string; ui_revision: number; expires_at: Date };
function mapHarness(row: HarnessRow): Harness { return { ownerId: row.owner_id, harnessId: row.harness_id, activeVersion: row.active_version, paused: row.paused, config: row.config, configHash: row.config_hash }; }
function mapDraft(row: DraftRow): Draft { return { ownerId: row.owner_id, harnessId: row.harness_id, baseVersion: row.base_version, config: row.config, cursor: row.cursor, revision: row.ui_revision, expiresAt: row.expires_at }; }

async function ensureOwnerOn(client: Pool | PoolClient, telegramUserId: string, chatId: string): Promise<string> {
  requireValid(digits(telegramUserId) && digits(chatId));
  const result = await client.query("INSERT INTO owners(id,telegram_user_id,private_chat_id) VALUES($1,$2,$3) ON CONFLICT(telegram_user_id) DO UPDATE SET telegram_user_id=EXCLUDED.telegram_user_id WHERE owners.private_chat_id=EXCLUDED.private_chat_id RETURNING id", [randomUUID(),telegramUserId,chatId]);
  if (!result.rows[0]) throw new StoreError("AUTH_DENIED");
  return result.rows[0].id as string;
}

/** Every instance is bound to a single owner and a single database transaction. */
export class OwnerTransaction {
  constructor(private readonly client: PoolClient, public readonly ownerId: string) {}
  private async audit(action: string, resourceId: string | null): Promise<void> { await this.client.query("INSERT INTO audit_events(id,owner_id,action,resource_id) VALUES($1,$2,$3,$4)", [randomUUID(),this.ownerId,action,resourceId]); }
  async getWorkspace(): Promise<{state: Json; revision: number} | null> {
    await this.client.query("SELECT id FROM owners WHERE id=$1 FOR UPDATE",[this.ownerId]);
    const q=await this.client.query("SELECT state,revision FROM workspace_state WHERE owner_id=$1 FOR UPDATE",[this.ownerId]);
    return q.rows[0] ? {state:q.rows[0].state, revision:q.rows[0].revision} : null;
  }
  async saveWorkspace(state: Json, expectedRevision: number): Promise<number> {
    requireValid(revisionValid(expectedRevision) && state!==null && typeof state==="object" && !Array.isArray(state));
    const json=canonicalJson(state);
    await this.client.query("SELECT id FROM owners WHERE id=$1 FOR UPDATE",[this.ownerId]);
    if (expectedRevision===0) {
      const q=await this.client.query("INSERT INTO workspace_state(owner_id,state,revision) VALUES($1,$2::jsonb,1) ON CONFLICT DO NOTHING RETURNING revision",[this.ownerId,json]);
      if (!q.rowCount) throw new StoreError("DRAFT_CONFLICT"); return q.rows[0].revision as number;
    }
    const q=await this.client.query("UPDATE workspace_state SET state=$2::jsonb,revision=revision+1,updated_at=now() WHERE owner_id=$1 AND revision=$3 RETURNING revision",[this.ownerId,json,expectedRevision]);
    if (!q.rowCount) throw new StoreError("DRAFT_CONFLICT"); return q.rows[0].revision as number;
  }
  async setPaused(harnessId: string, paused: boolean): Promise<Harness> {
    requireValid(harnessIdValid(harnessId) && typeof paused==="boolean");
    const q=await this.client.query("UPDATE harnesses SET paused=$3, capability_epoch=capability_epoch+CASE WHEN paused<>$3 THEN 1 ELSE 0 END WHERE owner_id=$1 AND harness_id=$2 RETURNING harness_id",[this.ownerId,harnessId,paused]);
    if (!q.rowCount) throw new StoreError("NOT_FOUND"); await this.audit(paused ? "harness.paused" : "harness.resumed",harnessId); return (await this.getHarness(harnessId))!;
  }
  async restoreVersion(harnessId: string, version: number, expectedActiveVersion: number): Promise<Harness> {
    requireValid(harnessIdValid(harnessId) && revisionValid(version) && version>0 && revisionValid(expectedActiveVersion) && expectedActiveVersion>0);
    const original=await this.client.query("SELECT config FROM harness_versions WHERE owner_id=$1 AND harness_id=$2 AND version=$3",[this.ownerId,harnessId,version]);
    if (!original.rows[0]) throw new StoreError("NOT_FOUND"); const json=configJson(original.rows[0].config,harnessId);
    const changed=await this.client.query("UPDATE harnesses SET active_version=active_version+1 WHERE owner_id=$1 AND harness_id=$2 AND active_version=$3 RETURNING active_version",[this.ownerId,harnessId,expectedActiveVersion]);
    if (!changed.rowCount) throw new StoreError("VERSION_CONFLICT");
    await this.client.query("INSERT INTO harness_versions(owner_id,harness_id,version,config,config_hash) VALUES($1,$2,$3,$4::jsonb,$5)",[this.ownerId,harnessId,changed.rows[0].active_version,json,digest(json)]);
    await this.audit("harness.version_restored",harnessId); return (await this.getHarness(harnessId))!;
  }
  async createHarness(harnessId: string, config: unknown): Promise<Harness> {
    requireValid(harnessIdValid(harnessId)); const json = configJson(config,harnessId);
    const created = await this.client.query("INSERT INTO harnesses(owner_id,harness_id,active_version) VALUES($1,$2,1) ON CONFLICT DO NOTHING RETURNING harness_id", [this.ownerId,harnessId]);
    if (!created.rowCount) throw new StoreError("DRAFT_EXISTS");
    await this.client.query("INSERT INTO harness_versions(owner_id,harness_id,version,config,config_hash) VALUES($1,$2,1,$3::jsonb,$4)",[this.ownerId,harnessId,json,digest(json)]);
    await this.audit("harness.created",harnessId);
    return (await this.getHarness(harnessId))!;
  }
  async getHarness(harnessId: string): Promise<Harness | null> {
    requireValid(harnessIdValid(harnessId));
    const q=await this.client.query("SELECT h.owner_id,h.harness_id,h.active_version,h.paused,v.config,v.config_hash FROM harnesses h JOIN harness_versions v ON v.owner_id=h.owner_id AND v.harness_id=h.harness_id AND v.version=h.active_version WHERE h.owner_id=$1 AND h.harness_id=$2",[this.ownerId,harnessId]);
    return q.rows[0] ? mapHarness(q.rows[0]) : null;
  }
  async listHarnesses(): Promise<Harness[]> {
    const q=await this.client.query("SELECT h.owner_id,h.harness_id,h.active_version,h.paused,v.config,v.config_hash FROM harnesses h JOIN harness_versions v ON v.owner_id=h.owner_id AND v.harness_id=h.harness_id AND v.version=h.active_version WHERE h.owner_id=$1 ORDER BY h.created_at,h.harness_id",[this.ownerId]);
    return q.rows.map(mapHarness);
  }
  async getDraft(): Promise<Draft | null> {
    const q=await this.client.query("SELECT * FROM draft_sessions WHERE owner_id=$1 AND expires_at>now()",[this.ownerId]); return q.rows[0] ? mapDraft(q.rows[0]) : null;
  }
  async saveDraft(harnessId: string, baseVersion: number, config: unknown, cursor: string, expectedDraftRevision: number): Promise<Draft> {
    requireValid(harnessIdValid(harnessId) && revisionValid(baseVersion) && revisionValid(expectedDraftRevision) && typeof cursor === "string" && cursor.length > 0 && cursor.length <= 80);
    const json=configJson(config,harnessId);
    // Lock the owner row to serialize creation and update of the one draft per owner.
    await this.client.query("SELECT id FROM owners WHERE id=$1 FOR UPDATE",[this.ownerId]);
    await this.client.query("DELETE FROM draft_sessions WHERE owner_id=$1 AND expires_at<=now()",[this.ownerId]);
    const existing=await this.client.query("SELECT * FROM draft_sessions WHERE owner_id=$1 FOR UPDATE",[this.ownerId]);
    if (existing.rows[0]) {
      const current=mapDraft(existing.rows[0]);
      if (current.harnessId!==harnessId) throw new StoreError("DRAFT_EXISTS");
      if (current.baseVersion!==baseVersion || current.revision!==expectedDraftRevision) throw new StoreError("DRAFT_CONFLICT");
      const q=await this.client.query("UPDATE draft_sessions SET config=$2::jsonb,cursor=$3,ui_revision=ui_revision+1,expires_at=now()+interval '24 hours' WHERE owner_id=$1 RETURNING *",[this.ownerId,json,cursor]);
      return mapDraft(q.rows[0]);
    }
    if (expectedDraftRevision!==0) throw new StoreError("DRAFT_CONFLICT");
    const harness=await this.getHarness(harnessId);
    if (baseVersion===0 && harness) throw new StoreError("DRAFT_EXISTS");
    if (baseVersion>0 && !harness) throw new StoreError("NOT_FOUND");
    if (baseVersion>0 && harness!.activeVersion!==baseVersion) throw new StoreError("VERSION_CONFLICT");
    const q=await this.client.query("INSERT INTO draft_sessions(owner_id,harness_id,base_version,config,cursor,ui_revision) VALUES($1,$2,$3,$4::jsonb,$5,1) RETURNING *",[this.ownerId,harnessId,baseVersion,json,cursor]); return mapDraft(q.rows[0]);
  }
  async discardDraft(harnessId: string, expectedDraftRevision: number): Promise<void> {
    requireValid(harnessIdValid(harnessId) && revisionValid(expectedDraftRevision));
    const q=await this.client.query("DELETE FROM draft_sessions WHERE owner_id=$1 AND harness_id=$2 AND ui_revision=$3 AND expires_at>now() RETURNING owner_id",[this.ownerId,harnessId,expectedDraftRevision]);
    if (!q.rowCount) throw new StoreError("DRAFT_CONFLICT");
  }
  async commitDraft(harnessId: string, expectedBaseVersion: number, expectedDraftRevision: number): Promise<Harness> {
    requireValid(harnessIdValid(harnessId) && revisionValid(expectedBaseVersion) && revisionValid(expectedDraftRevision));
    await this.client.query("SELECT id FROM owners WHERE id=$1 FOR UPDATE",[this.ownerId]);
    const q=await this.client.query("SELECT * FROM draft_sessions WHERE owner_id=$1 AND harness_id=$2 AND expires_at>now() FOR UPDATE",[this.ownerId,harnessId]);
    if (!q.rows[0]) throw new StoreError("NOT_FOUND");
    const draft=mapDraft(q.rows[0]);
    if (draft.baseVersion!==expectedBaseVersion || draft.revision!==expectedDraftRevision) throw new StoreError("DRAFT_CONFLICT");
    const json=configJson(draft.config,harnessId);
    if (expectedBaseVersion===0) {
      const newHarness=await this.createHarness(harnessId,draft.config);
      await this.client.query("DELETE FROM draft_sessions WHERE owner_id=$1",[this.ownerId]);
      return newHarness;
    }
    const changed=await this.client.query("UPDATE harnesses SET active_version=active_version+1 WHERE owner_id=$1 AND harness_id=$2 AND active_version=$3 RETURNING active_version",[this.ownerId,harnessId,expectedBaseVersion]);
    if (!changed.rowCount) throw new StoreError("VERSION_CONFLICT");
    const version=changed.rows[0].active_version as number;
    await this.client.query("INSERT INTO harness_versions(owner_id,harness_id,version,config,config_hash) VALUES($1,$2,$3,$4::jsonb,$5)",[this.ownerId,harnessId,version,json,digest(json)]);
    await this.client.query("DELETE FROM draft_sessions WHERE owner_id=$1",[this.ownerId]);
    await this.audit("harness.version_applied",harnessId);
    return (await this.getHarness(harnessId))!;
  }
  async enqueueOutbox(dedupKey: string, payload: Json): Promise<boolean> {
    requireValid(typeof dedupKey === "string" && dedupKey.length>0 && dedupKey.length<=160);
    const q=await this.client.query("INSERT INTO outbox(id,owner_id,dedup_key,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(owner_id,dedup_key) DO NOTHING RETURNING id",[randomUUID(),this.ownerId,dedupKey,canonicalJson(payload)]); return Boolean(q.rowCount);
  }
  async claimNextOutbox(): Promise<OutboxItem | null> {
    // A timed-out send might have reached Telegram: never re-send it blindly.
    await this.client.query("SELECT id FROM owners WHERE id=$1 FOR UPDATE",[this.ownerId]);
    await this.client.query("UPDATE outbox SET status=CASE WHEN payload->>'kind' IN ('edit_panel','edit_panel_view','callback_ack') THEN 'pending' ELSE 'unknown' END,lease_id=NULL,lease_expires_at=NULL WHERE owner_id=$1 AND status='sending' AND lease_expires_at<=now()",[this.ownerId]);
    const inFlight=await this.client.query("SELECT 1 FROM outbox WHERE owner_id=$1 AND status='sending' AND lease_expires_at>now() LIMIT 1",[this.ownerId]);
    if (inFlight.rowCount) return null;
    const leaseId=randomUUID();
    const q=await this.client.query("WITH candidate AS (SELECT id FROM outbox WHERE owner_id=$1 AND status='pending' AND available_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE outbox SET status='sending',lease_id=$2,lease_expires_at=now()+interval '1 minute',attempts=attempts+1 WHERE id=(SELECT id FROM candidate) RETURNING id,dedup_key,payload,attempts",[this.ownerId,leaseId]);
    return q.rows[0] ? {id:q.rows[0].id,leaseId,dedupKey:q.rows[0].dedup_key,payload:q.rows[0].payload,attempts:q.rows[0].attempts} : null;
  }
  async ackOutbox(id: string, leaseId: string, messageId?: string | null): Promise<boolean> {
    requireValid(uuidValid(id) && uuidValid(leaseId) && (messageId == null || digits(messageId)));
    const q=await this.client.query("UPDATE outbox SET status='delivered',telegram_message_id=$4,lease_id=NULL,lease_expires_at=NULL WHERE owner_id=$1 AND id=$2 AND lease_id=$3 AND status='sending' AND lease_expires_at>now() RETURNING id",[this.ownerId,id,leaseId,messageId ?? null]); return Boolean(q.rowCount);
  }
  async rescheduleOutbox(id: string, leaseId: string, delaySeconds: number): Promise<boolean> {
    requireValid(uuidValid(id) && uuidValid(leaseId) && Number.isInteger(delaySeconds) && delaySeconds>=0 && delaySeconds<=3600);
    const q=await this.client.query("UPDATE outbox SET status='pending',available_at=now()+($4::int * interval '1 second'),lease_id=NULL,lease_expires_at=NULL WHERE owner_id=$1 AND id=$2 AND lease_id=$3 AND status='sending' AND lease_expires_at>now() RETURNING id",[this.ownerId,id,leaseId,delaySeconds]); return Boolean(q.rowCount);
  }
  async failOutbox(id: string, leaseId: string, code: string): Promise<boolean> {
    requireValid(uuidValid(id) && uuidValid(leaseId) && typeof code==="string" && /^[A-Z0-9_]{1,80}$/.test(code));
    const q=await this.client.query("UPDATE outbox SET status='failed',last_error_code=$4,lease_id=NULL,lease_expires_at=NULL WHERE owner_id=$1 AND id=$2 AND lease_id=$3 AND status='sending' AND lease_expires_at>now() RETURNING id",[this.ownerId,id,leaseId,code]); return Boolean(q.rowCount);
  }
  async markOutboxUnknown(id: string, leaseId: string): Promise<boolean> {
    requireValid(uuidValid(id) && uuidValid(leaseId));
    const q=await this.client.query("UPDATE outbox SET status='unknown',lease_id=NULL,lease_expires_at=NULL WHERE owner_id=$1 AND id=$2 AND lease_id=$3 AND status='sending' RETURNING id",[this.ownerId,id,leaseId]); return Boolean(q.rowCount);
  }
  async createCallback(input: CallbackInput): Promise<string> {
    requireValid(digits(input.chatId) && digits(input.messageId) && typeof input.action==="string" && input.action.length>0 && input.action.length<=80 && (input.resourceId===null || (typeof input.resourceId==="string" && input.resourceId.length<=80)) && revisionValid(input.revision) && input.expiresAt instanceof Date && Number.isFinite(input.expiresAt.getTime()));
    const token=randomBytes(24).toString("base64url"); const payload=canonicalJson(input.payload);
    const q=await this.client.query("INSERT INTO callback_tokens(token_hash,owner_id,chat_id,message_id,action,resource_id,revision,payload,payload_hash,expires_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10 WHERE $10::timestamptz>now() AND $10::timestamptz<=now()+interval '15 minutes' RETURNING token_hash",[digest(token),this.ownerId,input.chatId,input.messageId,input.action,input.resourceId,input.revision,payload,digest(payload),input.expiresAt]);
    if (!q.rowCount) throw new StoreError("INVALID_INPUT"); return `cb:${token}`;
  }
  async consumeCallback(callback: string, binding: CallbackBinding): Promise<CallbackAction | null> {
    requireValid(typeof callback==="string" && /^cb:[A-Za-z0-9_-]{32}$/.test(callback));
    return this.consumeCallbackHash(digest(callback.slice(3)),binding);
  }
  async consumeCallbackHash(hash: string, binding: CallbackBinding): Promise<CallbackAction | null> {
    requireValid(typeof hash==="string" && /^[a-f0-9]{64}$/.test(hash) && digits(binding.chatId) && digits(binding.messageId) && revisionValid(binding.revision));
    const q=await this.client.query("UPDATE callback_tokens SET consumed_at=now() WHERE token_hash=$1 AND owner_id=$2 AND chat_id=$3 AND message_id=$4 AND revision=$5 AND consumed_at IS NULL AND expires_at>now() RETURNING action,resource_id,payload,payload_hash",[hash,this.ownerId,binding.chatId,binding.messageId,binding.revision]);
    if (!q.rows[0]) return null;
    const row=q.rows[0];
    if (digest(canonicalJson(row.payload))!==row.payload_hash) throw new StoreError("INVALID_INPUT");
    return {action:row.action,resourceId:row.resource_id,payload:row.payload};
  }
}

export class RelayStore {
  constructor(private readonly pool: Pool) {}
  async ensureOwner(telegramUserId: string, chatId: string): Promise<string> { return ensureOwnerOn(this.pool,telegramUserId,chatId); }
  async withOwner<T>(ownerId: string, operation: (tx: OwnerTransaction) => Promise<T>): Promise<T> {
    requireValid(uuidValid(ownerId)); const client=await this.pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT set_config('relay.owner_id',$1,true)",[ownerId]); const result=await operation(new OwnerTransaction(client,ownerId)); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK").catch(()=>{}); throw error; }
    finally { client.release(); }
  }
  async getPrivateChatId(ownerId: string): Promise<string | null> {
    requireValid(uuidValid(ownerId));
    const q = await this.pool.query("SELECT private_chat_id FROM owners WHERE id=$1", [ownerId]);
    const chatId = q.rows[0]?.private_chat_id;
    return typeof chatId === "string" && /^[0-9]{1,20}$/u.test(chatId) ? chatId : null;
  }
  async listOwnerIds(after?: string, limit = 100): Promise<string[]> {
    requireValid((after===undefined || uuidValid(after)) && Number.isInteger(limit) && limit>0 && limit<=1000);
    const q=await this.pool.query("SELECT id FROM owners WHERE ($1::uuid IS NULL OR id>$1::uuid) ORDER BY id LIMIT $2",[after ?? null,limit]); return q.rows.map(row => row.id as string);
  }
  async recordUpdate(botId: string, updateId: string, payload: unknown): Promise<boolean> {
    requireValid(digits(botId) && digits(updateId));
    const result=await this.pool.query("INSERT INTO inbox_updates(bot_id,update_id,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING update_id",[botId,updateId,canonicalJson(payload)]); return Boolean(result.rowCount);
  }
  async processNextUpdate<T>(botId: string, resolveActor: (payload: Json) => Actor | null, handler: (payload: Json, tx: OwnerTransaction, updateId: string) => Promise<T>): Promise<{processed:boolean; result?:T}> {
    requireValid(digits(botId)); const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      const q=await client.query("SELECT update_id,payload FROM inbox_updates WHERE bot_id=$1 AND processed_at IS NULL ORDER BY received_at,update_id FOR UPDATE SKIP LOCKED LIMIT 1",[botId]);
      if (!q.rows[0]) { await client.query("COMMIT"); return {processed:false}; }
      const {update_id:updateId,payload}=q.rows[0] as {update_id:string;payload:Json};
      const actor=resolveActor(payload); let result:T | undefined;
      if (actor) {
        const ownerId=await ensureOwnerOn(client,actor.telegramUserId,actor.chatId);
        await client.query("SELECT set_config('relay.owner_id',$1,true)",[ownerId]);
        result=await handler(payload,new OwnerTransaction(client,ownerId),updateId);
      }
      await client.query("UPDATE inbox_updates SET processed_at=now() WHERE bot_id=$1 AND update_id=$2",[botId,updateId]);
      await client.query("COMMIT"); return {processed:true,result};
    } catch(error) { await client.query("ROLLBACK").catch(()=>{}); throw error; }
    finally { client.release(); }
  }
}
