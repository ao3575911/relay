import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import { ChatGptSignInAttempt, createChatGptHostId, SignInError, verifyChatGptIdentity } from "../../packages/chatgpt/src/signin.js";
import { startLocalSignIn } from "../../packages/chatgpt/src/local-signin.js";

const clientId="oaiapp_example123";
const hostId=createChatGptHostId();
const options=()=>({ownerId:"owner-1",hostId,redirectUri:"http://127.0.0.1:1455/auth/callback"});
function callback(attempt:ChatGptSignInAttempt, change:Record<string,string>={}) {
  const authorization=new URL(attempt.authorizationUrl);
  const result=new URL(authorization.searchParams.get("redirect_uri")!);
  for(const [key,value] of Object.entries({state:authorization.searchParams.get("state")!,code:"sample-code",client_id:clientId,...change})) result.searchParams.set(key,value);
  return result.toString();
}
function tokenResponse(idToken:string, scope="openid profile email resource.invoke chatgpt.tokens.use.direct") {
  return new Response(JSON.stringify({id_token:idToken,access_token:"fake-access-token",token_type:"Bearer",expires_in:3600,scope}));
}

describe("local ChatGPT sign-in",()=>{
  it("uses PKCE, verifies identity and consent, and keeps the token out of JSON",async()=>{
    const {privateKey,publicKey}=await generateKeyPair("ES256");
    let idToken="";
    const fetcher=vi.fn(async()=>tokenResponse(idToken)) as unknown as typeof fetch;
    const key=await exportJWK(publicKey); key.kid="test-key";
    const keys=createLocalJWKSet({keys:[key]});
    const verifyIdentity=(token:string,id:string)=>verifyChatGptIdentity(token,id,keys);
    const mutable=options();
    const attempt=new ChatGptSignInAttempt(mutable,{fetcher,verifyIdentity});
    mutable.ownerId="other-owner";
    const url=new URL(attempt.authorizationUrl), nonce=url.searchParams.get("nonce")!;
    expect(url.origin).toBe("https://auth.openai.com");
    expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("chatgpt.tokens.use.direct");
    expect(JSON.stringify(attempt)).not.toContain(nonce);
    idToken=await new SignJWT({nonce}).setProtectedHeader({alg:"ES256",kid:"test-key"}).setIssuer("https://auth.openai.com").setAudience(clientId).setSubject("user-1").setIssuedAt().setExpirationTime("5m").sign(privateKey);
    const signed=await attempt.complete(callback(attempt));
    expect(signed).toMatchObject({ownerId:"owner-1",clientId,subject:"user-1"});
    expect(signed.accessToken).toBe("fake-access-token");
    expect(JSON.stringify(signed)).not.toContain("fake-access-token");
    const [endpoint,init]=vi.mocked(fetcher).mock.calls[0]!;
    expect(endpoint).toBe("https://auth.openai.com/api/accounts/oauth/token");
    expect(init?.redirect).toBe("error");
    const form=new URLSearchParams(String(init?.body));
    expect(form.get("client_id")).toBe(clientId); expect(form.get("redirect_uri")).toBe(options().redirectUri);
    await expect(attempt.complete(callback(attempt))).rejects.toMatchObject({code:"ALREADY_USED"});
  });
  it("rejects mismatched state without consuming the valid attempt",async()=>{
    let nonce="";
    const fetcher=vi.fn(async()=>tokenResponse("test-id-token")) as unknown as typeof fetch;
    const attempt=new ChatGptSignInAttempt(options(),{fetcher,verifyIdentity:async()=>({subject:"user-1",nonce})});
    nonce=new URL(attempt.authorizationUrl).searchParams.get("nonce")!;
    await expect(attempt.complete(callback(attempt,{state:"wrong"}))).rejects.toMatchObject({code:"INVALID_CALLBACK"});
    expect(fetcher).not.toHaveBeenCalled();
    await expect(attempt.complete(callback(attempt))).resolves.toMatchObject({ownerId:"owner-1"});
  });
  it("cryptographically rejects tokens with the wrong issuer, audience, or expiry",async()=>{
    const {privateKey,publicKey}=await generateKeyPair("ES256");
    const key=await exportJWK(publicKey); key.kid="verify-key";
    const keys=createLocalJWKSet({keys:[key]});
    for (const [issuer,audience,expiry] of [["https://wrong.example",clientId,"5m"],["https://auth.openai.com","oaiapp_wrong123","5m"],["https://auth.openai.com",clientId,"-1h"]]) {
      const token=await new SignJWT({nonce:"nonce"}).setProtectedHeader({alg:"ES256",kid:"verify-key"}).setIssuer(issuer!).setAudience(audience!).setSubject("user-1").setIssuedAt().setExpirationTime(expiry!).sign(privateKey);
      await expect(verifyChatGptIdentity(token,clientId,keys)).rejects.toThrow();
    }
  });
  it("rejects invalid signature, wrong nonce, missing plan permission, and declined consent",async()=>{
    const badSignature=new ChatGptSignInAttempt(options(),{fetcher:vi.fn(async()=>tokenResponse("invalid")) as unknown as typeof fetch,verifyIdentity:async()=>{throw new Error("signature rejected");}});
    await expect(badSignature.complete(callback(badSignature))).rejects.toMatchObject({code:"IDENTITY_INVALID"});
    const badNonce=new ChatGptSignInAttempt(options(),{fetcher:vi.fn(async()=>tokenResponse("token")) as unknown as typeof fetch,verifyIdentity:async()=>({subject:"user-1",nonce:"incorrect"})});
    await expect(badNonce.complete(callback(badNonce))).rejects.toMatchObject({code:"IDENTITY_INVALID"});
    let nonce="";
    const noConsent=new ChatGptSignInAttempt(options(),{fetcher:vi.fn(async()=>tokenResponse("token","openid email")) as unknown as typeof fetch,verifyIdentity:async()=>({subject:"user-1",nonce})});
    nonce=new URL(noConsent.authorizationUrl).searchParams.get("nonce")!;
    await expect(noConsent.complete(callback(noConsent))).rejects.toMatchObject({code:"PLAN_NOT_AUTHORIZED"});
    const fetcher=vi.fn() as unknown as typeof fetch;
    const denied=new ChatGptSignInAttempt(options(),{fetcher});
    await expect(denied.complete(callback(denied,{error:"access_denied"}))).rejects.toMatchObject({code:"DECLINED"});
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires a loopback callback and expires old sign-in attempts",async()=>{
    expect(()=>new ChatGptSignInAttempt({...options(),redirectUri:"https://example.org/auth/callback"})).toThrow(SignInError);
    let now=1000;
    const attempt=new ChatGptSignInAttempt(options(),{now:()=>now}); now+=600001;
    await expect(attempt.complete(callback(attempt))).rejects.toMatchObject({code:"EXPIRED"});
  });
  it("reuses a prior registration and rejects a different account or client",async()=>{
    let nonce="";
    const dependencies={fetcher:vi.fn(async()=>tokenResponse("token")) as unknown as typeof fetch,verifyIdentity:async()=>({subject:"user-1",nonce})};
    const previous={clientId,subject:"user-1"};
    const attempt=new ChatGptSignInAttempt({...options(),previous},dependencies);
    const url=new URL(attempt.authorizationUrl); nonce=url.searchParams.get("nonce")!;
    expect(url.searchParams.get("client_id")).toBe(clientId); expect(url.searchParams.has("agent_name_hint")).toBe(false);
    const cb=new URL(callback(attempt)); cb.searchParams.delete("client_id");
    await expect(attempt.complete(cb.toString())).resolves.toMatchObject({clientId,subject:"user-1"});
    const mismatch=new ChatGptSignInAttempt({...options(),previous},dependencies);
    nonce=new URL(mismatch.authorizationUrl).searchParams.get("nonce")!;
    await expect(mismatch.complete(callback(mismatch,{client_id:"oaiapp_other123"}))).rejects.toMatchObject({code:"INVALID_CALLBACK"});
    const otherAccount=new ChatGptSignInAttempt({...options(),previous:{clientId,subject:"different-user"}},dependencies);
    nonce=new URL(otherAccount.authorizationUrl).searchParams.get("nonce")!;
    await expect(otherAccount.complete(callback(otherAccount))).rejects.toMatchObject({code:"IDENTITY_INVALID"});
  });
  it("runs a loopback callback without exposing the token to the browser",async()=>{
    let nonce="";
    const local=await startLocalSignIn({ownerId:"owner-1",hostId,timeoutMs:3000},{fetcher:vi.fn(async()=>tokenResponse("token")) as unknown as typeof fetch,verifyIdentity:async()=>({subject:"user-1",nonce})});
    const url=new URL(local.authorizationUrl); nonce=url.searchParams.get("nonce")!;
    const cb=new URL(url.searchParams.get("redirect_uri")!);
    cb.searchParams.set("state",url.searchParams.get("state")!); cb.searchParams.set("code","sample-code"); cb.searchParams.set("client_id",clientId);
    const response=await fetch(cb); const body=await response.text();
    expect(response.status).toBe(200); expect(body).not.toContain("fake-access-token");
    expect((await local.result).accessToken).toBe("fake-access-token");
  });
  it("closes a cancelled loopback sign-in",async()=>{
    const local=await startLocalSignIn({ownerId:"owner-1",hostId,timeoutMs:3000});
    const result=local.result; local.cancel();
    await expect(result).rejects.toMatchObject({code:"DECLINED"});
  });
});
