import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { RelayStore, StoreError, canonicalJson, type Json } from "../../packages/storage/src/index.js";
import { createWorkspace, newConfig } from "../../packages/domain/src/index.js";
import { handleUpdate, resolveActor } from "../../apps/bot/src/controller.js";
import { pollBatch, type PollingApi } from "../../apps/bot/src/polling.js";
import { dispatchOne, processOneUpdate } from "../../apps/bot/src/worker.js";
import type { TelegramDeliveryApi } from "../../apps/bot/src/delivery.js";

const dbUrl = process.env.RELAY_TEST_DATABASE_URL;
const schema = `relay_test_${randomBytes(6).toString("hex")}`;
const role = `relay_role_${randomBytes(6).toString("hex")}`;
const password = randomBytes(18).toString("hex");
let admin: pg.Pool;
let pool: pg.Pool;
let store: RelayStore;
let alice: string;
let bob: string;
const config = (id: string) => newConfig(id);

describe.skipIf(!dbUrl)("Postgres tenant-scoped storage", () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: dbUrl });
    await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
    await admin.query(`CREATE SCHEMA ${schema} AUTHORIZATION ${role}`);
    const url = new URL(dbUrl!); url.username = role; url.password = password;
    pool = new pg.Pool({ connectionString: url.toString(), options: `-c search_path=${schema}` });
    expect((await pool.query("SHOW is_superuser")).rows[0].is_superuser).toBe("off");
    await pool.query(await readFile(new URL("../../packages/storage/migrations/001_initial.sql", import.meta.url), "utf8"));
    store = new RelayStore(pool);
    alice = await store.ensureOwner("10101", "10101");
    bob = await store.ensureOwner("20202", "20202");
  });
  afterAll(async () => {
    await pool?.end();
    if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.query(`DROP ROLE IF EXISTS ${role}`); await admin.end(); }
  });
  it("uses PostgreSQL RLS and owner-scoped queries to prevent cross-user access", async () => {
    await store.withOwner(alice, tx => tx.createHarness("h_private", config("h_private")));
    expect(await store.withOwner(bob, tx => tx.getHarness("h_private"))).toBeNull();
    const c=await pool.connect();
    try { await c.query("BEGIN"); await c.query("SELECT set_config('relay.owner_id',$1,true)",[bob]); expect((await c.query("SELECT * FROM harnesses WHERE harness_id='h_private'")).rowCount).toBe(0); await c.query("ROLLBACK"); } finally { c.release(); }
    expect((await pool.query("SELECT * FROM harnesses")).rowCount).toBe(0);
  });
  it("creates a new harness only when its creation draft is committed", async () => {
    const d=await store.withOwner(alice, tx => tx.saveDraft("h_new",0,config("h_new"),"name",0));
    expect(d.revision).toBe(1);
    expect(await store.withOwner(alice, tx => tx.getHarness("h_new"))).toBeNull();
    const h=await store.withOwner(alice, tx => tx.commitDraft("h_new",0,1));
    expect(h.activeVersion).toBe(1); expect(await store.withOwner(alice,tx=>tx.getDraft())).toBeNull();
  });
  it("permits only one concurrent commit and preserves immutable history", async () => {
    const c=config("h_new"); c.name="Renamed";
    await store.withOwner(alice,tx=>tx.saveDraft("h_new",1,c,"review",0));
    const results=await Promise.allSettled([store.withOwner(alice,tx=>tx.commitDraft("h_new",1,1)),store.withOwner(alice,tx=>tx.commitDraft("h_new",1,1))]);
    expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(x=>x.status==="rejected")).toHaveLength(1);
    expect((await store.withOwner(alice,tx=>tx.getHarness("h_new")))?.activeVersion).toBe(2);
    const client=await pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT set_config('relay.owner_id',$1,true)",[alice]); await expect(client.query("UPDATE harness_versions SET config='{}'::jsonb WHERE owner_id=$1 AND harness_id=$2 AND version=1",[alice,"h_new"])).rejects.toThrow(); await client.query("ROLLBACK"); } finally { client.release(); }
  });
  it("rejects unsafe configs and deeply nested input", async () => {
    const bad=config("h_bad"); (bad.policy as {approvalMode:string}).approvalMode="never";
    await expect(store.withOwner(alice,tx=>tx.createHarness("h_bad",bad))).rejects.toMatchObject({code:"INVALID_INPUT"});
    const other=config("h_bad"); (other.tools as Record<string, unknown>).shell=true;
    await expect(store.withOwner(alice,tx=>tx.createHarness("h_bad",other))).rejects.toMatchObject({code:"INVALID_INPUT"});
    let deep: unknown=null; for (let i=0;i<40;i++) deep=[deep];
    expect(()=>canonicalJson(deep)).toThrow(StoreError);
  });
  it("consumes an owner/chat/message/revision-bound callback exactly once", async () => {
    const token=await store.withOwner(alice,tx=>tx.createCallback({chatId:"10101",messageId:"7",action:"review",resourceId:"h_new",revision:4,payload:{intent:"review"},expiresAt:new Date(Date.now()+60000)}));
    const hash=createHash("sha256").update(token.slice(3)).digest("hex");
    expect(await store.withOwner(bob,tx=>tx.consumeCallbackHash(hash,{chatId:"10101",messageId:"7",revision:4}))).toBeNull();
    expect(await store.withOwner(alice,tx=>tx.consumeCallbackHash(hash,{chatId:"10101",messageId:"8",revision:4}))).toBeNull();
    expect((await store.withOwner(alice,tx=>tx.consumeCallbackHash(hash,{chatId:"10101",messageId:"7",revision:4})))?.action).toBe("review");
    expect(await store.withOwner(alice,tx=>tx.consumeCallbackHash(hash,{chatId:"10101",messageId:"7",revision:4}))).toBeNull();
  });
  it("deduplicates inbox updates and rolls back processing and outbox together", async () => {
    const update={message:{text:"sample"}};
    expect(await store.recordUpdate("111","44",update)).toBe(true);
    expect(await store.recordUpdate("111","44",update)).toBe(false);
    const actor=()=>({telegramUserId:"10101",chatId:"10101"});
    await expect(store.processNextUpdate("111",actor,async (_p,tx)=>{await tx.enqueueOutbox("rollback-test",{kind:"send_panel"}); throw new Error("forced rollback");})).rejects.toThrow("forced rollback");
    const result=await store.processNextUpdate("111",actor,async (_p,tx)=>{ expect(await tx.enqueueOutbox("rollback-test",{kind:"send_panel"})).toBe(true); return "ok"; });
    expect(result).toEqual({processed:true,result:"ok"});
    expect((await store.processNextUpdate("111",actor,async()=>"again")).processed).toBe(false);
  });
  it("serializes outbox claims per owner", async () => {
    await store.withOwner(bob,async tx=>{await tx.enqueueOutbox("a",{kind:"send_panel"}); await tx.enqueueOutbox("b",{kind:"send_panel"});});
    const results=await Promise.all([store.withOwner(bob,tx=>tx.claimNextOutbox()),store.withOwner(bob,tx=>tx.claimNextOutbox())]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const claimed=results.find(Boolean)!;
    expect(await store.withOwner(bob,tx=>tx.ackOutbox(claimed.id,claimed.leaseId,"7"))).toBe(true);
    expect(await store.withOwner(bob,tx=>tx.claimNextOutbox())).not.toBeNull();
  });
  it("reclaims expired semantic edits but quarantines ambiguous sends", async () => {
    const owner=await store.ensureOwner("30303","30303");
    await store.withOwner(owner,tx=>tx.enqueueOutbox("edit",{kind:"edit_panel_view"}));
    const edit=(await store.withOwner(owner,tx=>tx.claimNextOutbox()))!;
    await store.withOwner(owner,tx=>tx.enqueueOutbox("send",{kind:"send_panel_view"}));
    const expire=async (id:string) => {
      const client=await pool.connect();
      try { await client.query("BEGIN"); await client.query("SELECT set_config('relay.owner_id',$1,true)",[owner]); await client.query("UPDATE outbox SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[id]); await client.query("COMMIT"); }
      finally { client.release(); }
    };
    await expire(edit.id);
    const reclaimed=(await store.withOwner(owner,tx=>tx.claimNextOutbox()))!;
    expect(reclaimed.id).toBe(edit.id);
    await store.withOwner(owner,tx=>tx.ackOutbox(reclaimed.id,reclaimed.leaseId));
    const send=(await store.withOwner(owner,tx=>tx.claimNextOutbox()))!;
    expect(send.id).not.toBe(edit.id);
    await expire(send.id);
    expect(await store.withOwner(owner,tx=>tx.claimNextOutbox())).toBeNull();
    const client=await pool.connect();
    try { await client.query("BEGIN"); await client.query("SELECT set_config('relay.owner_id',$1,true)",[owner]); expect((await client.query("SELECT status FROM outbox WHERE id=$1",[send.id])).rows[0].status).toBe("unknown"); await client.query("ROLLBACK"); }
    finally { client.release(); }
  });
  it("rejects stale workspace revisions and keeps state tenant-scoped", async () => {
    expect(await store.withOwner(alice,tx=>tx.saveWorkspace({workspace:{ownerId:alice}},0))).toBe(1);
    expect(await store.withOwner(bob,tx=>tx.getWorkspace())).toBeNull();
    await expect(store.withOwner(alice,tx=>tx.saveWorkspace({workspace:{}},0))).rejects.toMatchObject({code:"DRAFT_CONFLICT"});
    expect(await store.withOwner(alice,tx=>tx.saveWorkspace({workspace:{ownerId:alice}},1))).toBe(2);
  });
  it("persists one reviewed demo through the real inbox, controller, and owner-scoped storage", async () => {
    const owner=await store.ensureOwner("40404","40404");
    const c=config("h_demo");
    const state=createWorkspace(owner); state.revision=1; state.screen="demo_review"; state.selectedId=c.id; state.demoTask="Plan a small project.";
    state.harnesses=[{id:c.id,ownerId:owner,activeVersion:1,paused:false,versions:[{version:1,config:c}]}];
    const token=await store.withOwner(owner,async tx=>{
      await tx.createHarness(c.id,c);
      await tx.saveWorkspace({workspace:state as unknown as Json,panelMessageId:"7"},0);
      return tx.createCallback({chatId:"40404",messageId:"7",action:"demo_start",resourceId:null,revision:1,payload:{value:""},expiresAt:new Date(Date.now()+60000)});
    });
    const hash=createHash("sha256").update(token.slice(3)).digest("hex");
    const payload={update_id:900,callback_query:{id:"demo-query",from:{id:40404},message:{message_id:7,chat:{id:40404}},data:`cbh:${hash}`}};
    expect(await store.recordUpdate("555","900",payload)).toBe(true);
    expect((await store.processNextUpdate("555",resolveActor,handleUpdate)).processed).toBe(true);
    const saved=await store.withOwner(owner,tx=>tx.getWorkspace());
    const workspace=(saved!.state as {workspace: {screen:string;demoRuns:{task:string;harnessVersion:number}[]}}).workspace;
    expect(workspace.screen).toBe("demo_result"); expect(workspace.demoRuns).toHaveLength(1);
    expect(workspace.demoRuns[0]).toMatchObject({task:"Plan a small project.",harnessVersion:1});
    expect(await store.recordUpdate("555","900",payload)).toBe(false);
    expect(await store.recordUpdate("555","901",{...payload,update_id:901})).toBe(true);
    await store.processNextUpdate("555",resolveActor,handleUpdate);
    const replay=await store.withOwner(owner,tx=>tx.getWorkspace());
    expect((replay!.state as {workspace: {demoRuns:unknown[]}}).workspace.demoRuns).toHaveLength(1);
    expect(await store.withOwner(bob,tx=>tx.getHarness("h_demo"))).toBeNull();
  });
  it("processes polled Telegram messages and button callbacks through real storage", async () => {
    let updates:unknown[]=[{update_id:1000,message:{message_id:5,chat:{id:50505,type:"private"},from:{id:50505},text:"/start"}}];
    const polling:PollingApi={getWebhookInfo:async()=>({url:""}),getUpdates:async()=>updates};
    expect(await pollBatch(polling,store,"777",1000)).toBe(1001);
    expect(await processOneUpdate(store,"777")).toBe(true);
    const owner=await store.ensureOwner("50505","50505");
    let keyboard:{inline_keyboard:{text:string;callback_data:string}[][]}|undefined;
    const api:TelegramDeliveryApi={
      sendMessage:async()=>({message_id:44}),
      editMessageText:async (_chat,_id,_text,options)=>{keyboard=options.reply_markup;},
      answerCallbackQuery:async()=>true,
      sendDocument:async()=>({message_id:45}),
    };
    expect(await dispatchOne(store,owner,api)).toBe(true);
    expect(await dispatchOne(store,owner,api)).toBe(true);
    const create=keyboard!.inline_keyboard.flat().find(button=>button.text==="Create harness")!;
    expect(create.callback_data).toMatch(/^cb:[A-Za-z0-9_-]{32}$/);
    updates=[{update_id:1001,callback_query:{id:"query",from:{id:50505},message:{message_id:44,chat:{id:50505,type:"private"}},data:create.callback_data}}];
    expect(await pollBatch(polling,store,"777",1001)).toBe(1002);
    expect(await processOneUpdate(store,"777")).toBe(true);
    const saved=await store.withOwner(owner,tx=>tx.getWorkspace());
    expect((saved!.state as {workspace:{screen:string}}).workspace.screen).toBe("mode");
    expect(await dispatchOne(store,owner,api)).toBe(true);
    expect(await dispatchOne(store,owner,api)).toBe(true);
    expect(keyboard!.inline_keyboard.flat().some(button=>button.text.includes("Simple"))).toBe(true);
  });
  it("keeps polling ownership exclusive across database connections",async()=>{
    const first=await pool.connect(), second=await pool.connect(), key=`relay:test:${randomBytes(8).toString("hex")}`;
    try {
      expect((await first.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",[key])).rows[0].acquired).toBe(true);
      expect((await second.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",[key])).rows[0].acquired).toBe(false);
      await first.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))",[key]);
      expect((await second.query("SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",[key])).rows[0].acquired).toBe(true);
      await second.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))",[key]);
    } finally { first.release(); second.release(); }
  });
});
