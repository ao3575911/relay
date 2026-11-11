/** Personal, user-controlled local Sign in with ChatGPT. No token persistence. */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { ChatGptSession } from "./index.js";

export type SignInFailure = "INVALID_SETUP" | "INVALID_CALLBACK" | "DECLINED" | "EXPIRED" | "ALREADY_USED" | "TOKEN_EXCHANGE_FAILED" | "IDENTITY_INVALID" | "PLAN_NOT_AUTHORIZED";
export class SignInError extends Error {
  constructor(public readonly code: SignInFailure) { super(code); this.name = "SignInError"; }
}
export interface SignedInSession extends ChatGptSession { clientId: string; subject: string }
export interface PreviousRegistration { clientId: string; subject: string }
interface AttemptOptions { ownerId: string; hostId: string; redirectUri: string; previous?: PreviousRegistration }
interface Identity { subject: string; nonce: string }
export interface SignInDependencies { fetcher?: typeof globalThis.fetch; verifyIdentity?: (idToken:string, clientId:string) => Promise<Identity>; now?: () => number }

const issuer = "https://auth.openai.com";
const authEndpoint = `${issuer}/api/accounts/authorize`;
const tokenEndpoint = `${issuer}/api/accounts/oauth/token`;
const resource = "https://api.openai.com/v1";
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { timeoutDuration: 10000 });
const nonceBytes = () => randomBytes(32).toString("base64url");
const idPattern = /^oaiapp_[A-Za-z0-9_-]{8,128}$/u;

/** The host ID is not a credential; retain it with the same local runtime. */
export function createChatGptHostId(): string { return `urn:uuid:${randomUUID()}`; }
export async function verifyChatGptIdentity(idToken: string, clientId: string, keys: JWTVerifyGetKey = jwks): Promise<Identity> {
  const {payload} = await jwtVerify(idToken, keys, {issuer, audience:clientId, requiredClaims:["sub", "exp", "iat"], clockTolerance:5});
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.nonce !== "string") throw new SignInError("IDENTITY_INVALID");
  return {subject:payload.sub, nonce:payload.nonce};
}
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
function one(query: URLSearchParams, key: string): string | undefined {
  const values=query.getAll(key);
  if (values.length > 1) throw new SignInError("INVALID_CALLBACK");
  return values[0];
}
function validateRedirect(value: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/auth/callback" || !url.port || url.username || url.password || url.search || url.hash) throw new Error("invalid");
    return url;
  } catch { throw new SignInError("INVALID_SETUP"); }
}
async function readTokenBody(response: Response): Promise<unknown> {
  if (!response.body) throw new SignInError("TOKEN_EXCHANGE_FAILED");
  const reader=response.body.getReader(), decoder=new TextDecoder(); let text="";
  try {
    for (;;) { const part=await reader.read(); if (part.done) break; text+=decoder.decode(part.value,{stream:true}); if (text.length > 65536) throw new SignInError("TOKEN_EXCHANGE_FAILED"); }
    text+=decoder.decode(); if (text.length > 65536) throw new SignInError("TOKEN_EXCHANGE_FAILED");
    return JSON.parse(text) as unknown;
  } catch { throw new SignInError("TOKEN_EXCHANGE_FAILED"); }
  finally { void reader.cancel().catch(()=>{}); reader.releaseLock(); }
}

/** One-time PKCE attempt. Never serialize or log the returned attempt or session. */
export class ChatGptSignInAttempt {
  readonly authorizationUrl: string;
  private readonly state=nonceBytes();
  private readonly nonce=nonceBytes();
  private readonly verifier=nonceBytes();
  private readonly createdAt: number;
  private used=false;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly verify: (idToken:string, clientId:string) => Promise<Identity>;
  private readonly now: () => number;
  private readonly redirect: URL;
  private readonly ownerId: string;
  private readonly previous: PreviousRegistration | undefined;

  constructor(options: AttemptOptions, dependencies: SignInDependencies = {}) {
    if (typeof options.ownerId !== "string" || !options.ownerId.trim() || options.ownerId.length > 128 || !/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(options.hostId)) throw new SignInError("INVALID_SETUP");
    if (options.previous && (typeof options.previous.clientId !== "string" || !idPattern.test(options.previous.clientId) || typeof options.previous.subject !== "string" || !options.previous.subject || options.previous.subject.length > 1024)) throw new SignInError("INVALID_SETUP");
    this.redirect=validateRedirect(options.redirectUri); this.ownerId=options.ownerId;
    this.previous=options.previous ? {...options.previous} : undefined;
    this.fetcher=dependencies.fetcher ?? globalThis.fetch; this.verify=dependencies.verifyIdentity ?? verifyChatGptIdentity; this.now=dependencies.now ?? Date.now;
    this.createdAt=this.now();
    const url=new URL(authEndpoint);
    const params: Record<string,string> = {
      client_id:this.previous?.clientId ?? "dynamic_agent_client", ext_agent_host_id:options.hostId,
      response_type:"code", redirect_uri:this.redirect.toString(), scope:"openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
      resource, state:this.state, nonce:this.nonce, code_challenge_method:"S256",
      code_challenge:createHash("sha256").update(this.verifier).digest("base64url"),
    };
    if (!this.previous) params.agent_name_hint="Relay";
    for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
    this.authorizationUrl=url.toString();
  }

  /** Checks the original state without consuming the attempt, for loopback routing. */
  matchesState(callbackUrl: string): boolean {
    try {
      const url=new URL(callbackUrl);
      const state=one(url.searchParams,"state");
      return url.origin === this.redirect.origin && url.pathname === this.redirect.pathname && !url.username && !url.password && !url.hash && typeof state === "string" && safeEqual(state,this.state);
    } catch { return false; }
  }

  async complete(callbackUrl: string, signal?: AbortSignal): Promise<SignedInSession> {
    if (this.used) throw new SignInError("ALREADY_USED");
    if (this.now() - this.createdAt > 10 * 60 * 1000 || this.now() < this.createdAt) { this.used=true; throw new SignInError("EXPIRED"); }
    if (!this.matchesState(callbackUrl)) throw new SignInError("INVALID_CALLBACK");
    this.used=true;
    const query=new URL(callbackUrl).searchParams;
    const error=one(query,"error"), code=one(query,"code"), returnedClientId=one(query,"client_id");
    if (error) throw new SignInError("DECLINED");
    if (this.previous && returnedClientId && returnedClientId !== this.previous.clientId) throw new SignInError("INVALID_CALLBACK");
    const clientId=this.previous?.clientId ?? returnedClientId;
    if (!code || code.length > 4096 || !clientId || !idPattern.test(clientId)) throw new SignInError("INVALID_CALLBACK");
    const body=new URLSearchParams({grant_type:"authorization_code",client_id:clientId,code,code_verifier:this.verifier,redirect_uri:this.redirect.toString(),resource});
    let tokenData: unknown;
    try {
      const deadline=AbortSignal.timeout(15000);
      const response=await this.fetcher(tokenEndpoint,{method:"POST",redirect:"error",headers:{"content-type":"application/x-www-form-urlencoded","accept":"application/json"},body:body.toString(),signal:signal ? AbortSignal.any([signal,deadline]) : deadline});
      if (!response.ok) { await response.body?.cancel().catch(()=>{}); throw new SignInError("TOKEN_EXCHANGE_FAILED"); }
      tokenData=await readTokenBody(response);
    } catch { throw new SignInError("TOKEN_EXCHANGE_FAILED"); }
    if (!tokenData || typeof tokenData !== "object" || Array.isArray(tokenData)) throw new SignInError("TOKEN_EXCHANGE_FAILED");
    const tokens=tokenData as Record<string,unknown>;
    if (typeof tokens.id_token !== "string" || tokens.id_token.length > 16384 || typeof tokens.access_token !== "string" || !/^[\x21-\x7e]{1,8192}$/u.test(tokens.access_token) || typeof tokens.scope !== "string" || tokens.scope.length > 4096 || typeof tokens.expires_in !== "number" || !Number.isSafeInteger(tokens.expires_in) || tokens.expires_in <= 30 || tokens.expires_in > 86400 || typeof tokens.token_type !== "string" || tokens.token_type.toLowerCase() !== "bearer") throw new SignInError("TOKEN_EXCHANGE_FAILED");
    const scopes=tokens.scope.split(/\s+/u);
    let identity: Identity;
    try { identity=await this.verify(tokens.id_token,clientId); }
    catch { throw new SignInError("IDENTITY_INVALID"); }
    if (typeof identity.subject !== "string" || !identity.subject || typeof identity.nonce !== "string" || !safeEqual(identity.nonce,this.nonce) || (this.previous && identity.subject !== this.previous.subject)) throw new SignInError("IDENTITY_INVALID");
    if (!scopes.includes("chatgpt.tokens.use.direct") || !scopes.includes("resource.invoke")) throw new SignInError("PLAN_NOT_AUTHORIZED");
    const session: SignedInSession={ownerId:this.ownerId,accessToken:tokens.access_token,scopes:Object.freeze(scopes),expiresAtMs:this.now()+tokens.expires_in*1000,clientId,subject:identity.subject};
    // Prevent accidental inclusion in JSON logs or workspace persistence.
    Object.defineProperty(session,"accessToken",{value:tokens.access_token,enumerable:false,writable:false,configurable:false});
    return Object.freeze(session);
  }
  toJSON(): { status: string } { return {status:"sign_in_attempt"}; }
}
