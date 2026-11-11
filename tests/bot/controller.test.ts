import { describe, expect, it } from "vitest";
import { ACCESS_REFUSAL, handleUpdate, type ControllerTransaction, type DraftRecord, type Json } from "../../apps/bot/src/controller.js";

class MemoryTx implements ControllerTransaction {
  ownerId = "owner-1";
  state: {state: Json; revision: number} | null = null;
  draft: DraftRecord | null = null;
  harnesses: Json[] = [];
  paused = false;
  outbox: { key: string; payload: Json }[] = [];
  tokens = new Map<string, {revision:number; chatId:string; messageId:string; action:string; payload:Json}>();
  async getWorkspace() { return this.state && structuredClone(this.state); }
  async getHarness(harnessId:string) {
    const config = this.harnesses.find(h => h && typeof h === "object" && !Array.isArray(h) && h.id === harnessId);
    return config ? {ownerId:this.ownerId,harnessId,activeVersion:1,paused:this.paused,config:structuredClone(config)} : null;
  }
  async saveWorkspace(state:Json, expected:number) { if ((this.state?.revision ?? 0) !== expected) throw new Error("conflict"); this.state = {state:structuredClone(state), revision:expected+1}; return expected+1; }
  async getDraft() { return this.draft && structuredClone(this.draft); }
  async saveDraft(harnessId:string, baseVersion:number, config:unknown, _cursor:string, revision:number) {
    if ((this.draft?.revision ?? 0) !== revision) throw new Error("conflict");
    this.draft = {harnessId,baseVersion,config:structuredClone(config) as Json,revision:revision+1};
  }
  async commitDraft(harnessId:string, baseVersion:number, revision:number) {
    if (!this.draft || this.draft.harnessId !== harnessId || this.draft.baseVersion !== baseVersion || this.draft.revision !== revision) throw new Error("conflict");
    this.harnesses.push(this.draft.config); this.draft=null;
  }
  async discardDraft(harnessId:string, revision:number) { if (!this.draft || this.draft.harnessId !== harnessId || this.draft.revision !== revision) throw new Error("conflict"); this.draft=null; }
  async setPaused() { return undefined; }
  async restoreVersion() { return undefined; }
  async consumeCallbackHash(hash:string, binding:{chatId:string;messageId:string;revision:number}) {
    const token=this.tokens.get(hash);
    if (!token || token.chatId!==binding.chatId || token.messageId!==binding.messageId || token.revision!==binding.revision) return null;
    this.tokens.delete(hash); return {action:token.action,resourceId:null,payload:token.payload};
  }
  async enqueueOutbox(key:string,payload:Json) { if (this.outbox.some(row=>row.key===key)) return false; this.outbox.push({key,payload:structuredClone(payload)}); return true; }
}
const message = (id:number,text:string,extra:Record<string,Json>={}) => ({ update_id:id,message:{from:{id:123},chat:{id:123},text},...extra }) as Json;
function callback(id:number,hash:string) { return {update_id:id,callback_query:{id:`q${id}`,from:{id:123},message:{message_id:42,chat:{id:123}},data:`cbh:${hash}`}} as Json; }
function giveToken(tx:MemoryTx,hash:string,action:string,value="") { tx.tokens.set(hash,{action,payload:{value},revision:tx.state!.revision,chatId:"123",messageId:"42"}); }
function connectPanel(tx:MemoryTx) { const state=tx.state!.state as Record<string,Json>; state.panelMessageId="42"; }

describe("transactional Telegram controller",()=>{
  it("opens an empty workspace without storing bearer callbacks in the outbox",async()=>{
    const tx=new MemoryTx(); await handleUpdate(message(1,"/start"),tx,"1");
    expect(tx.state?.revision).toBe(1); expect(tx.outbox).toHaveLength(1);
    expect(JSON.stringify(tx.outbox)).not.toMatch(/cb:[A-Za-z0-9_-]{32}/);
    expect(JSON.stringify(tx.outbox)).toContain("send_panel_view");
  });
  it("creates one version through persisted wizard transitions and rejects an old token",async()=>{
    const tx=new MemoryTx(); await handleUpdate(message(1,"/start"),tx,"1"); connectPanel(tx);
    const a="a".repeat(64),b="b".repeat(64);
    giveToken(tx,a,"create"); giveToken(tx,b,"create");
    await handleUpdate(callback(2,a),tx,"2");
    expect(tx.draft?.baseVersion).toBe(0);
    await handleUpdate(callback(3,b),tx,"3");
    expect(tx.harnesses).toHaveLength(0);
    for(const [number,action,value] of [[4,"mode","simple"],[5,"template","research"],[6,"use_name",""],[7,"save_new",""]] as const){ const hash=String(number).repeat(64); giveToken(tx,hash,action,value); await handleUpdate(callback(number,hash),tx,String(number)); }
    expect(tx.harnesses).toHaveLength(1); expect(tx.draft).toBeNull();
    expect(JSON.stringify(tx.outbox)).not.toMatch(/cb:[A-Za-z0-9_-]{32}/);
  });
  it("never applies the redacted credential marker as a user input",async()=>{
    const tx=new MemoryTx(); await handleUpdate(message(1,"/start"),tx,"1");
    await handleUpdate(message(2,"[Sensitive input removed]",{relay_error:"sensitive_input"}),tx,"2");
    expect(tx.harnesses).toHaveLength(0); expect(JSON.stringify(tx.outbox)).toContain("It was not saved");
  });
  it("records a confirmed demo once and reopens its history",async()=>{
    const tx=new MemoryTx(); await handleUpdate(message(1,"/start"),tx,"1"); connectPanel(tx);
    for (const [number,action,value] of [[2,"create",""],[3,"mode","simple"],[4,"template","research"],[5,"use_name",""],[6,"save_new",""],[7,"demo_task",""],[8,"demo_sample",""]] as const) {
      const hash=number.toString(16).padStart(64,"0"); giveToken(tx,hash,action,value); await handleUpdate(callback(number,hash),tx,String(number));
    }
    const hash="a".repeat(64); giveToken(tx,hash,"demo_start");
    await handleUpdate(callback(9,hash),tx,"9");
    await handleUpdate(callback(10,hash),tx,"10");
    const state=tx.state!.state as {workspace:{demoRuns:{id:string;task:string;harnessVersion:number}[]}};
    expect(state.workspace.demoRuns).toHaveLength(1);
    expect(state.workspace.demoRuns[0]).toMatchObject({task:"Help me plan a productive week.",harnessVersion:1});
    expect(JSON.stringify(tx.outbox)).toContain("No AI calls, tool execution or provider charges");
    const history="b".repeat(64); giveToken(tx,history,"demo_history"); await handleUpdate(callback(11,history),tx,"11");
    const open="c".repeat(64); giveToken(tx,open,"demo_open",state.workspace.demoRuns[0]!.id); await handleUpdate(callback(12,open),tx,"12");
    expect(JSON.stringify(tx.outbox)).toContain("Demo complete");
  });
  it("rejects a demo if the authoritative harness was paused after review",async()=>{
    const tx=new MemoryTx(); await handleUpdate(message(1,"/start"),tx,"1"); connectPanel(tx);
    for (const [number,action,value] of [[2,"create",""],[3,"mode","simple"],[4,"template","blank"],[5,"use_name",""],[6,"save_new",""],[7,"demo_task",""],[8,"demo_sample",""]] as const) {
      const hash=number.toString(16).padStart(64,"0"); giveToken(tx,hash,action,value); await handleUpdate(callback(number,hash),tx,String(number));
    }
    tx.paused=true; const hash="d".repeat(64); giveToken(tx,hash,"demo_start"); await handleUpdate(callback(9,hash),tx,"9");
    const state=tx.state!.state as {workspace:{screen:string;harnesses:{paused:boolean}[];demoRuns?:unknown[]}};
    expect(state.workspace.screen).toBe("home"); expect(state.workspace.harnesses[0]?.paused).toBe(true);
    expect(state.workspace.demoRuns ?? []).toHaveLength(0); expect(JSON.stringify(tx.outbox)).toContain("changed or is unavailable");
  });
  it("refuses a Telegram user who is not on the allowlist", async () => {
    const tx = new MemoryTx();
    await handleUpdate(message(1, "/start"), tx, "1", { allowedUserIds: new Set(["999"]) });
    expect(tx.state).toBeNull();
    expect(tx.outbox).toEqual([{ key: "update:1:refusal", payload: { kind: "send_notice", chatId: "123", text: ACCESS_REFUSAL } }]);
  });
  it("queues a model run instead of the scripted example when a key is configured", async () => {
    const tx = new MemoryTx();
    await handleUpdate(message(1, "/start"), tx, "1", { modelConfigured: true, today: "2026-11-11" });
    connectPanel(tx);
    for (const [number, action, value] of [[2, "create", ""], [3, "mode", "simple"], [4, "template", "research"], [5, "use_name", ""], [6, "save_new", ""], [7, "demo_task", ""], [8, "demo_sample", ""]] as const) {
      const hash = number.toString(16).padStart(64, "0");
      giveToken(tx, hash, action, value);
      await handleUpdate(callback(number, hash), tx, String(number), { modelConfigured: true, today: "2026-11-11" });
    }
    const hash = "e".repeat(64);
    giveToken(tx, hash, "demo_start");
    await handleUpdate(callback(9, hash), tx, "9", { modelConfigured: true, today: "2026-11-11" });
    const state = tx.state!.state as { workspace: { demoRuns: { status?: string; source?: string }[] } };
    expect(state.workspace.demoRuns[0]).toMatchObject({ source: "model", status: "pending" });
    expect(JSON.stringify(tx.outbox)).toContain("Run in progress");
    expect(JSON.stringify(tx.outbox)).not.toContain("simulation");
  });
});
