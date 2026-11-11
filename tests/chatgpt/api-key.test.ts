import { describe, expect, it, vi } from "vitest";
import { ChatGptClient, ChatGptError } from "../../packages/chatgpt/src/index.js";

const key = "sk-test-key-value-not-a-real-secret";
const event = (data: unknown) => `data: ${JSON.stringify(data)}\r\n\r\n`;
const stream = (text: string, status = 200) => new Response(new ReadableStream({
  start(controller) {
    const bytes = new TextEncoder().encode(text);
    controller.enqueue(bytes);
    controller.close();
  },
}), { status, headers: { "content-type": "text/event-stream", "x-request-id": "req_safe" } });
const request = { apiKey: key, model: "gpt-6-luna", task: "Plan a week", instructions: "Be concise", timeoutMs: 30_000, maxOutputTokens: 128 };

describe("OpenAI API-key Responses calls", () => {
  it("sends one tool-free streamed request and returns the completed text", async () => {
    const fetcher = vi.fn(async () => stream(event({ type: "response.output_text.delta", delta: "A plan" }) + event({ type: "response.completed" }))) as unknown as typeof fetch;
    expect(await new ChatGptClient(fetcher).generateWithApiKey(request)).toBe("A plan");
    const [url, init] = vi.mocked(fetcher).mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.redirect).toBe("error");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${key}`);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-6-luna",
      instructions: "Be concise\n\nTools are disabled. Reply in plain text. Do not ask for secrets.",
      input: [{ role: "user", content: "Plan a week" }],
      max_output_tokens: 128,
      reasoning: { effort: "none" },
      store: false,
      stream: true,
    });
    expect(JSON.parse(String(init?.body)).tools).toBeUndefined();
  });
  it("refuses a missing key or an unsafe task before any request", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    await expect(new ChatGptClient(fetcher).generateWithApiKey({ ...request, apiKey: "not-a-key" })).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await expect(new ChatGptClient(fetcher).generateWithApiKey({ ...request, task: "sk-THIS_IS_A_FAKE_CREDENTIAL_123456789" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("classifies a provider failure without echoing the key or the body", async () => {
    const fetcher = vi.fn(async () => new Response(`private ${key}`, { status: 401, headers: { "x-request-id": "req_safe" } })) as unknown as typeof fetch;
    let caught: unknown;
    try { await new ChatGptClient(fetcher).generateWithApiKey(request); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(ChatGptError);
    expect(caught).toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
    expect(String(caught)).not.toContain(key);
    expect(JSON.stringify(caught)).not.toContain("private");
  });
});
