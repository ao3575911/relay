import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkPollingAvailable, pollBatch, runPolling, type PollingApi } from "../../apps/bot/src/polling.js";
import type { UpdateInbox } from "../../apps/bot/src/webhook.js";

const message = (id:number,text="/start") => ({update_id:id,message:{message_id:10,chat:{id:123,type:"private"},from:{id:123},text}});
const callback = (id:number) => ({update_id:id,callback_query:{id:"query",from:{id:123},message:{message_id:10,chat:{id:123,type:"private"}},data:`cb:${"a".repeat(32)}`}});
function fixture(updates: unknown[]) {
  const saved = new Map<string,unknown>();
  const api: PollingApi = {getWebhookInfo:vi.fn().mockResolvedValue({url:""}),getUpdates:vi.fn().mockResolvedValue(updates)};
  const inbox: UpdateInbox = {recordUpdate:vi.fn(async (_bot,id,payload)=>{if(!saved.has(id))saved.set(id,payload);return true;})};
  return {api,inbox,saved};
}

describe("Telegram long polling",()=>{
  it("refuses to alter an existing webhook",async()=>{
    const f=fixture([]); vi.mocked(f.api.getWebhookInfo).mockResolvedValue({url:"https://example.org/hook"});
    await expect(checkPollingAvailable(f.api)).rejects.toMatchObject({code:"WEBHOOK_ACTIVE"});
    expect(f.api.getUpdates).not.toHaveBeenCalled();
  });
  it("saves sanitized private updates before returning the confirmation offset",async()=>{
    const fake="sk-FAKE_SECRET_FOR_TEST_ONLY_123456789";
    const group=message(13); group.message.chat.type="group";
    const f=fixture([message(11,`Task ${fake}`),callback(12),group]);
    expect(await pollBatch(f.api,f.inbox,"12345",10)).toBe(14);
    expect(f.saved.size).toBe(2); expect(JSON.stringify([...f.saved.values()])).not.toContain(fake);
    expect(f.saved.get("11")).toMatchObject({relay_error:"sensitive_input"});
    expect(f.saved.get("12")).toMatchObject({callback_query:{data:`cbh:${createHash("sha256").update("a".repeat(32)).digest("hex")}`}});
    expect(f.api.getUpdates).toHaveBeenCalledWith(expect.objectContaining({offset:10,allowed_updates:["message","callback_query"]}),undefined);
  });
  it("does not confirm a batch when persistence fails and safely deduplicates replay",async()=>{
    const f=fixture([message(20),message(21)]);
    let fail=true;
    const original=f.inbox.recordUpdate;
    f.inbox.recordUpdate=vi.fn(async (bot,id,payload)=>{if(id==="21" && fail){fail=false;throw new Error("db unavailable");}return original(bot,id,payload);});
    await expect(pollBatch(f.api,f.inbox,"12345",20)).rejects.toThrow("db unavailable");
    expect(f.saved.size).toBe(1);
    expect(await pollBatch(f.api,f.inbox,"12345",20)).toBe(22);
    expect(f.saved.size).toBe(2);
    expect(vi.mocked(f.api.getUpdates).mock.calls.map(([x])=>x.offset)).toEqual([20,20]);
  });
  it("fails closed on malformed, unsorted, or overflowing update IDs",async()=>{
    for(const updates of [[{update_id:-1}], [message(3),message(2)], [message(Number.MAX_SAFE_INTEGER)]]){
      const f=fixture(updates);
      await expect(pollBatch(f.api,f.inbox,"12345")).rejects.toMatchObject({name:"PollingError"});
    }
  });
  it("stops instead of competing with another poller",async()=>{
    const f=fixture([]); vi.mocked(f.api.getUpdates).mockRejectedValue({error_code:409});
    await expect(runPolling(f.api,f.inbox,"12345",new AbortController().signal)).rejects.toMatchObject({code:"POLL_CONFLICT"});
    expect(f.api.getUpdates).toHaveBeenCalledTimes(1);
  });
});
