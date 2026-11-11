import { describe, expect, it, vi } from "vitest";
import { createWorkspace, render, type Workspace } from "../../packages/domain/src/index.js";
import type { RelayStore } from "../../packages/storage/src/index.js";
import { dispatchOne } from "../../apps/bot/src/worker.js";
import type { TelegramDeliveryApi } from "../../apps/bot/src/delivery.js";

function fixture() {
  const workspace: Workspace = { ...createWorkspace("owner-1"), revision: 1 };
  const state = { workspace, panelMessageId: null as string | null };
  const jobs: Array<{id:string; leaseId:string; dedupKey:string; attempts:number; payload:unknown; status:string}> = [{id:"one",leaseId:"lease",dedupKey:"start",attempts:1,payload:{kind:"send_panel_view",chatId:"123",revision:1,view:render(workspace,"owner-1")},status:"pending"}];
  const bindings: Array<{chatId:string;messageId:string;revision:number; action:string}> = [];
  let revision = 1;
  const tx = {
    async claimNextOutbox() { const job=jobs.find(x=>x.status==="pending"); if(job) job.status="sending"; return job ?? null; },
    async getWorkspace() { return {state:structuredClone(state),revision}; },
    async saveWorkspace(next:typeof state, expected:number) { if(expected!==revision) throw new Error("conflict"); Object.assign(state,structuredClone(next)); return ++revision; },
    async createCallback(binding:{chatId:string;messageId:string;revision:number;action:string}) { bindings.push(binding); return `cb:${String(bindings.length).padStart(32,"a")}`; },
    async enqueueOutbox(dedupKey:string,payload:unknown) { jobs.push({id:String(jobs.length+1),leaseId:"lease",dedupKey,attempts:1,payload:structuredClone(payload),status:"pending"}); return true; },
    async ackOutbox(id:string) { const job=jobs.find(x=>x.id===id); if(!job) return false; job.status="delivered"; return true; },
    async markOutboxUnknown(id:string) { const job=jobs.find(x=>x.id===id); if(!job) return false; job.status="unknown"; return true; },
    async failOutbox(id:string) { const job=jobs.find(x=>x.id===id); if(!job) return false; job.status="failed"; return true; },
    async rescheduleOutbox(id:string) { const job=jobs.find(x=>x.id===id); if(!job) return false; job.status="pending"; return true; },
  };
  const store = { async withOwner(_owner:string, fn:(transaction:typeof tx)=>Promise<unknown>) { return fn(tx); } } as unknown as RelayStore;
  const api: TelegramDeliveryApi = { sendMessage:vi.fn().mockResolvedValue({message_id:42}), editMessageText:vi.fn().mockResolvedValue(true), answerCallbackQuery:vi.fn().mockResolvedValue(true), sendDocument:vi.fn().mockResolvedValue({message_id:43}) };
  return {store,api,jobs,state,bindings};
}

describe("semantic outbox dispatch",()=>{
  it("binds callbacks to the confirmed Telegram message and keeps bearer tokens out of the database",async()=>{
    const f=fixture(); await dispatchOne(f.store,"owner-1",f.api);
    expect(f.state.panelMessageId).toBe("42"); expect(f.state.workspace.revision).toBe(2);
    expect(JSON.stringify(f.jobs)).not.toMatch(/cb:[A-Za-z0-9_-]{32}/);
    await dispatchOne(f.store,"owner-1",f.api);
    expect(f.api.editMessageText).toHaveBeenCalledTimes(1);
    expect(f.bindings.length).toBeGreaterThan(0);
    expect(f.bindings.every(b=>b.chatId==="123" && b.messageId==="42" && b.revision===2)).toBe(true);
    expect(JSON.stringify(f.jobs)).not.toMatch(/cb:[A-Za-z0-9_-]{32}/);
  });
  it("sends an access refusal once and does not open a panel", async () => {
    const f = fixture();
    f.jobs.splice(0, f.jobs.length, { id: "notice", leaseId: "lease", dedupKey: "refusal", attempts: 1, payload: { kind: "send_notice", chatId: "123", text: "Relay is not open to this Telegram account. Ask the operator if you need access." }, status: "pending" });
    await dispatchOne(f.store, "owner-1", f.api);
    expect(f.api.sendMessage).toHaveBeenCalledWith("123", "Relay is not open to this Telegram account. Ask the operator if you need access.", { parse_mode: "HTML" });
    expect(f.state.panelMessageId).toBeNull();
    expect(f.jobs.filter(job => job.status === "pending")).toHaveLength(0);
  });
  it("does not retry an ambiguous send",async()=>{
    const f=fixture(); vi.mocked(f.api.sendMessage).mockRejectedValue(new Error("timeout"));
    await dispatchOne(f.store,"owner-1",f.api); expect(f.jobs[0]?.status).toBe("unknown");
    expect(await dispatchOne(f.store,"owner-1",f.api)).toBe(false);
    expect(f.api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
