/**
 * ChatGPT plan-usage transport for a future user-controlled local runtime.
 *
 * The caller must obtain and validate the OAuth session through OpenAI's
 * supported sign-in flow, bind it to the requesting owner, and enforce the
 * runtime's policies. This module neither signs in nor stores credentials.
 * It is deliberately not connected to the hosted Telegram worker.
 */
import { isSafeText } from "../../domain/src/index.js";

export type ChatGptErrorCode = "AUTH_REQUIRED" | "ACCESS_DENIED" | "LIMIT_REACHED" | "UNAVAILABLE" | "INVALID_REQUEST" | "CANCELLED" | "TIMEOUT" | "NETWORK" | "STREAM_INTERRUPTED" | "OUTPUT_TOO_LARGE" | "PROVIDER_ERROR";
export class ChatGptError extends Error {
  constructor(public readonly code: ChatGptErrorCode, public readonly requestId?: string, public readonly httpStatus?: number) {
    super({
      AUTH_REQUIRED: "ChatGPT sign-in or plan permission is required.",
      ACCESS_DENIED: "ChatGPT could not authorize this request.",
      LIMIT_REACHED: "ChatGPT usage is currently limited.",
      UNAVAILABLE: "ChatGPT is temporarily unavailable.",
      INVALID_REQUEST: "The ChatGPT request is invalid or unsupported.",
      CANCELLED: "The request was cancelled.",
      TIMEOUT: "The request timed out.",
      NETWORK: "Could not reach ChatGPT.",
      STREAM_INTERRUPTED: "The response ended before completion.",
      OUTPUT_TOO_LARGE: "The response exceeded the output limit.",
      PROVIDER_ERROR: "ChatGPT could not complete the response.",
    }[code]);
    this.name = "ChatGptError";
  }
}

/** The caller supplies an already validated session for the signed-in owner. */
export interface ChatGptSession {
  ownerId: string;
  accessToken: string;
  scopes: readonly string[];
  expiresAtMs: number;
}
export interface ChatGptModel { slug: string; displayName: string }
export interface GenerateRequest {
  ownerId: string;
  model: string;
  task: string;
  instructions: string;
  timeoutMs: number;
  signal?: AbortSignal;
}
/** Platform API-key call. This is not Sign in with ChatGPT plan usage. */
export interface ApiKeyGenerateRequest {
  apiKey: string;
  model: string;
  task: string;
  instructions: string;
  timeoutMs: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

const endpoint = "https://api.openai.com/v1";
const maxOutput = 16000;
const maxEvent = 131072;
type Fetch = typeof globalThis.fetch;
interface PendingResponse { response: Response; deadline: AbortSignal; external?: AbortSignal }
function bodyError(error: unknown, pending: PendingResponse, requestId?: string): ChatGptError {
  if (error instanceof ChatGptError) return error;
  if (pending.external?.aborted) return new ChatGptError("CANCELLED", requestId);
  if (pending.deadline.aborted) return new ChatGptError("TIMEOUT", requestId);
  return new ChatGptError("NETWORK", requestId);
}

function authorize(session: ChatGptSession, ownerId: string): void {
  if (typeof ownerId !== "string" || !ownerId.trim() || ownerId.length > 128 || !session || session.ownerId !== ownerId || !Array.isArray(session.scopes) || !session.scopes.includes("chatgpt.tokens.use.direct") || !session.scopes.includes("resource.invoke") || !Number.isFinite(session.expiresAtMs) || session.expiresAtMs <= Date.now() + 30000 || typeof session.accessToken !== "string" || !/^[\x21-\x7e]{1,8192}$/u.test(session.accessToken)) throw new ChatGptError("AUTH_REQUIRED");
}
function statusError(status: number, requestId?: string): ChatGptError {
  if (status === 401) return new ChatGptError("AUTH_REQUIRED", requestId, status);
  if (status === 403) return new ChatGptError("ACCESS_DENIED", requestId, status);
  if (status === 429) return new ChatGptError("LIMIT_REACHED", requestId, status);
  if (status >= 500) return new ChatGptError("UNAVAILABLE", requestId, status);
  if (status >= 400) return new ChatGptError("INVALID_REQUEST", requestId, status);
  return new ChatGptError("PROVIDER_ERROR", requestId, status);
}
function safeRequestId(value: string | null): string | undefined {
  return value && /^[A-Za-z0-9_-]{1,120}$/u.test(value) ? value : undefined;
}
function eventError(event: Record<string, unknown>, requestId?: string): ChatGptError {
  const response = event.response && typeof event.response === "object" ? event.response as Record<string, unknown> : {};
  const rawError = response.error ?? event.error;
  const error = rawError && typeof rawError === "object" ? rawError as Record<string, unknown> : {};
  if (error.code === "subscription_sharing_usage_limit_exceeded") return new ChatGptError("LIMIT_REACHED", requestId);
  if (error.code === "subscription_sharing_usage_unavailable") return new ChatGptError("UNAVAILABLE", requestId);
  return new ChatGptError("PROVIDER_ERROR", requestId);
}

/** All provider calls use a fixed origin, no redirects, retries, tools or fallback. */
export class ChatGptClient {
  constructor(private readonly fetcher: Fetch = globalThis.fetch) {}

  async listModels(session: ChatGptSession, ownerId: string, signal?: AbortSignal): Promise<ChatGptModel[]> {
    authorize(session, ownerId);
    const pending = await this.request(`${endpoint}/models`, session.accessToken, { method: "GET", signal }, 15000);
    try {
      const raw = await readBody(pending.response, 262144);
      let data: unknown;
      try { data = JSON.parse(raw); } catch { throw new ChatGptError("PROVIDER_ERROR"); }
      if (!data || typeof data !== "object" || !Array.isArray((data as {models?: unknown}).models)) throw new ChatGptError("PROVIDER_ERROR");
      const models = (data as {models: unknown[]}).models;
      if (models.length > 1000) throw new ChatGptError("PROVIDER_ERROR");
      return models.flatMap(item => {
        if (!item || typeof item !== "object") return [];
        const m = item as Record<string, unknown>;
        return m.visibility === "list" && typeof m.slug === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(m.slug) && isSafeText(m.display_name, 100) ? [{ slug: m.slug, displayName: m.display_name }] : [];
      });
    } catch (error) { throw bodyError(error, pending); }
  }

  async generate(session: ChatGptSession, request: GenerateRequest): Promise<string> {
    authorize(session, request.ownerId);
    if (typeof request.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(request.model) || !isSafeText(request.task, 600) || !isSafeText(request.instructions, 2000) || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1000 || request.timeoutMs > 180000) throw new ChatGptError("INVALID_REQUEST");
    const body = JSON.stringify({ model: request.model, instructions: request.instructions, input: [{ role: "user", content: request.task }], store: false, stream: true });
    const pending = await this.request(`${endpoint}/responses`, session.accessToken, { method: "POST", headers: { "content-type": "application/json" }, body, signal: request.signal }, request.timeoutMs);
    if (!/^text\/event-stream(?:\s*;|$)/iu.test(pending.response.headers.get("content-type") ?? "")) {
      await pending.response.body?.cancel().catch(() => {}); throw new ChatGptError("STREAM_INTERRUPTED");
    }
    return readEvents(pending);
  }

  /**
   * One Responses API call with a platform API key.
   * No tools are sent. Reasoning effort is none so the visible answer is the billed output.
   * Errors never include the key or the provider body.
   */
  async generateWithApiKey(request: ApiKeyGenerateRequest): Promise<string> {
    if (!/^sk-[A-Za-z0-9_-]{20,300}$/u.test(request.apiKey)) throw new ChatGptError("AUTH_REQUIRED");
    if (typeof request.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(request.model) || !isSafeText(request.task, 600) || !isSafeText(request.instructions, 2000) || !Number.isInteger(request.timeoutMs) || request.timeoutMs < 1000 || request.timeoutMs > 180000 || !Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 16 || request.maxOutputTokens > 4096) throw new ChatGptError("INVALID_REQUEST");
    const instructions = `${request.instructions}\n\nTools are disabled. Reply in plain text. Do not ask for secrets.`;
    const body = JSON.stringify({ model: request.model, instructions, input: [{ role: "user", content: request.task }], max_output_tokens: request.maxOutputTokens, reasoning: { effort: "none" }, store: false, stream: true });
    const pending = await this.request(`${endpoint}/responses`, request.apiKey, { method: "POST", headers: { "content-type": "application/json" }, body, signal: request.signal }, request.timeoutMs);
    if (!/^text\/event-stream(?:\s*;|$)/iu.test(pending.response.headers.get("content-type") ?? "")) {
      await pending.response.body?.cancel().catch(() => {}); throw new ChatGptError("STREAM_INTERRUPTED");
    }
    return readEvents(pending);
  }

  private async request(url: string, accessToken: string, init: RequestInit, timeoutMs: number): Promise<PendingResponse> {
    if (init.signal?.aborted) throw new ChatGptError("CANCELLED");
    const deadline = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
    try {
      const response = await this.fetcher(url, { ...init, signal, redirect: "error", headers: { ...init.headers, authorization: `Bearer ${accessToken}` } });
      const requestId = safeRequestId(response.headers.get("x-request-id"));
      if (!response.ok) { await response.body?.cancel().catch(() => {}); throw statusError(response.status, requestId); }
      // The same signal continues to control body reads after fetch resolves.
      return { response, deadline, ...(init.signal ? { external: init.signal } : {}) };
    } catch (error) {
      if (error instanceof ChatGptError) throw error;
      if (init.signal?.aborted) throw new ChatGptError("CANCELLED");
      if (deadline.aborted) throw new ChatGptError("TIMEOUT");
      throw new ChatGptError("NETWORK");
    }
  }
}

async function readBody(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new ChatGptError("STREAM_INTERRUPTED");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > limit) throw new ChatGptError("OUTPUT_TOO_LARGE");
    }
    text += decoder.decode();
    if (text.length > limit) throw new ChatGptError("OUTPUT_TOO_LARGE");
    return text;
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

async function readEvents(pending: PendingResponse): Promise<string> {
  const response = pending.response;
  if (!response.body) throw new ChatGptError("STREAM_INTERRUPTED");
  const requestId = safeRequestId(response.headers.get("x-request-id"));
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "", data: string[] = [], output = "", completed = false;
  function line(value: string): void {
    if (value === "") {
      if (!data.length) return;
      const raw = data.join("\n"); data = [];
      if (raw === "[DONE]") return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(raw) as Record<string, unknown>; } catch { throw new ChatGptError("STREAM_INTERRUPTED", requestId); }
      if (!event || typeof event !== "object" || Array.isArray(event)) throw new ChatGptError("STREAM_INTERRUPTED", requestId);
      if (event.type === "response.output_text.delta") {
        if (typeof event.delta !== "string") throw new ChatGptError("STREAM_INTERRUPTED", requestId);
        output += event.delta;
        if (output.length > maxOutput) throw new ChatGptError("OUTPUT_TOO_LARGE", requestId);
      } else if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") throw eventError(event, requestId);
      else if (event.type === "response.completed") completed = true;
    } else if (value.startsWith("data:")) data.push(value.slice(5).replace(/^ /u, ""));
  }
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length + data.join("\n").length > maxEvent) throw new ChatGptError("OUTPUT_TOO_LARGE", requestId);
      for (;;) {
        const match = /\r\n|\r|\n/u.exec(buffer);
        if (!match || (!done && match[0] === "\r" && match.index === buffer.length - 1)) break;
        line(buffer.slice(0, match.index)); buffer = buffer.slice(match.index + match[0].length);
        if (completed) break;
      }
      if (done) break;
    }
    if (!completed || !output.trim()) throw new ChatGptError("STREAM_INTERRUPTED", requestId);
    return output;
  } catch (error) {
    throw bodyError(error, pending, requestId);
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
