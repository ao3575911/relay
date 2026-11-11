import { describe, expect, it, vi } from "vitest";
import { ChatGptClient, ChatGptError, type ChatGptSession, type GenerateRequest } from "../../packages/chatgpt/src/index.js";

const session = (): ChatGptSession => ({ ownerId: "owner-1", accessToken: "fake-oauth-token", scopes: ["resource.invoke", "chatgpt.tokens.use.direct"], expiresAtMs: Date.now() + 600000 });
const request = (): GenerateRequest => ({ ownerId: "owner-1", model: "example-model", task: "Plan a week", instructions: "Be concise", timeoutMs: 1000 });
const event = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const stream = (text: string) => new Response(new ReadableStream({
  start(controller) {
    const bytes = new TextEncoder().encode(text);
    for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7));
    controller.close();
  },
}), { headers: { "content-type": "text/event-stream; charset=utf-8", "x-request-id": "req_example" } });

describe("ChatGPT plan-usage transport", () => {
  it("sends the supported request and returns only a completed streamed answer", async () => {
    const fetcher = vi.fn(async () => stream(event({type:"response.created"}) + event({type:"response.output_text.delta",delta:"Hello "}) + event({type:"response.output_text.delta",delta:"🌍"}) + event({type:"response.completed"}))) as unknown as typeof fetch;
    const client = new ChatGptClient(fetcher);
    expect(await client.generate(session(), request())).toBe("Hello 🌍");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toEqual({model:"example-model",instructions:"Be concise",input:[{role:"user",content:"Plan a week"}],store:false,stream:true});
  });
  it("lists only models visible to the signed-in account", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({models:[{slug:"model-a",display_name:"Model A",visibility:"list"},{slug:"hidden",display_name:"Hidden",visibility:"hidden"},{slug:"bad slug",display_name:"Invalid",visibility:"list"}]}))) as unknown as typeof fetch;
    expect(await new ChatGptClient(fetcher).listModels(session(),"owner-1")).toEqual([{slug:"model-a",displayName:"Model A"}]);
    expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/models");
  });
  it("never sends a request for the wrong owner, missing consent, expired session, or unsafe task", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch, client = new ChatGptClient(fetcher);
    for (const bad of [{...session(),ownerId:"other"},{...session(),scopes:[]},{...session(),expiresAtMs:Date.now()}]) {
      await expect(client.generate(bad,request())).rejects.toMatchObject({code:"AUTH_REQUIRED"});
    }
    await expect(client.generate(session(),{...request(),task:"sk-THIS_IS_A_FAKE_CREDENTIAL_123456789"})).rejects.toMatchObject({code:"INVALID_REQUEST"});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[401,"AUTH_REQUIRED"],[403,"ACCESS_DENIED"],[429,"LIMIT_REACHED"],[503,"UNAVAILABLE"]] as const)("classifies HTTP %i without echoing provider or token data", async (status,code) => {
    const fetcher = vi.fn(async () => new Response("private response", {status,headers:{"x-request-id":"req_safe"}})) as unknown as typeof fetch;
    let caught: unknown;
    try { await new ChatGptClient(fetcher).generate(session(),request()); } catch (error) { caught=error; }
    expect(caught).toBeInstanceOf(ChatGptError); expect(caught).toMatchObject({code,requestId:"req_safe",httpStatus:status});
    expect(JSON.stringify(caught)).not.toContain("fake-oauth-token"); expect(String(caught)).not.toContain("private response");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not treat partial output, an error event, or a wrong content type as success", async () => {
    const badStreams = [
      stream(event({type:"response.output_text.delta",delta:"partial"})),
      stream(event({type:"response.output_text.delta",delta:"partial"}) + event({type:"response.failed",response:{error:{code:"subscription_sharing_usage_limit_exceeded"}}})),
      new Response("not an event stream",{headers:{"content-type":"text/plain"}}),
    ];
    for (const [index, response] of badStreams.entries()) {
      const fetcher = vi.fn(async () => response) as unknown as typeof fetch;
      await expect(new ChatGptClient(fetcher).generate(session(),request())).rejects.toMatchObject({code:index===1 ? "LIMIT_REACHED" : "STREAM_INTERRUPTED"});
    }
  });
  it("stops when a response exceeds the output limit", async () => {
    const fetcher = vi.fn(async () => stream(event({type:"response.output_text.delta",delta:"x".repeat(16001)}) + event({type:"response.completed"}))) as unknown as typeof fetch;
    await expect(new ChatGptClient(fetcher).generate(session(),request())).rejects.toMatchObject({code:"OUTPUT_TOO_LARGE"});
  });
  it("reports a cancelled request without retrying", async () => {
    const abort = new AbortController(); abort.abort();
    const fetcher = vi.fn(async () => { throw new Error("network detail"); }) as unknown as typeof fetch;
    await expect(new ChatGptClient(fetcher).generate(session(),{...request(),signal:abort.signal})).rejects.toMatchObject({code:"CANCELLED"});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("aborts a stalled response after its deadline", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(new ReadableStream({
      start(controller) { init?.signal?.addEventListener("abort", () => controller.error(init.signal!.reason), {once:true}); },
    }), {headers:{"content-type":"text/event-stream"}})) as unknown as typeof fetch;
    await expect(new ChatGptClient(fetcher).generate(session(),request())).rejects.toMatchObject({code:"TIMEOUT"});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
