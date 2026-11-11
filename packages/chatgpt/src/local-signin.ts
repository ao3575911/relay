/** Loopback-only sign-in window for a user's own runtime. */
import { createServer, type ServerResponse } from "node:http";
import { ChatGptSignInAttempt, SignInError, type PreviousRegistration, type SignedInSession, type SignInDependencies } from "./signin.js";

export interface LocalSignIn {
  authorizationUrl: string;
  result: Promise<SignedInSession>;
  cancel(): void;
}
function respond(response: ServerResponse, code: number, message: string): void {
  response.writeHead(code, {"content-type":"text/plain; charset=utf-8","cache-control":"no-store","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'","x-content-type-options":"nosniff"});
  response.end(message);
}

/** The owner binding must come from an explicit, verified local pairing. */
export async function startLocalSignIn(options: {ownerId:string;hostId:string;timeoutMs?:number;previous?:PreviousRegistration}, dependencies?: SignInDependencies): Promise<LocalSignIn> {
  const timeoutMs=options.timeoutMs ?? 10*60*1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10*60*1000) throw new SignInError("INVALID_SETUP");
  let attempt: ChatGptSignInAttempt | undefined;
  let port=0, finished=false, processing=false, activeResponse: ServerResponse | undefined;
  const abort=new AbortController();
  let resolveResult!: (session:SignedInSession)=>void, rejectResult!: (error:SignInError)=>void;
  const result=new Promise<SignedInSession>((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});
  const server=createServer((request,response)=>{
    if (finished || processing || request.method !== "GET" || request.headers.host !== `127.0.0.1:${port}` || !request.url || request.url.length > 8192) { respond(response,400,"This sign-in request is invalid."); return; }
    const callback=`http://127.0.0.1:${port}${request.url}`;
    if (!attempt?.matchesState(callback)) { respond(response,400,"This sign-in request is invalid."); return; }
    processing=true; activeResponse=response;
    void attempt.complete(callback,abort.signal).then(session=>{
      if (finished) return;
      respond(response,200,"ChatGPT sign-in completed. You can close this window.");
      finish(); resolveResult(session);
    }).catch((error:unknown)=>{
      if (finished) return;
      respond(response,400,"ChatGPT sign-in did not complete. You can close this window.");
      finish(); rejectResult(error instanceof SignInError ? error : new SignInError("TOKEN_EXCHANGE_FAILED"));
    });
  });
  server.headersTimeout=10000; server.requestTimeout=10000; server.maxConnections=4; server.maxHeadersCount=50;
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",()=>{server.off("error",reject);resolve();});});
  const address=server.address();
  if (!address || typeof address === "string") { server.close(); throw new SignInError("INVALID_SETUP"); }
  port=address.port;
  try { attempt=new ChatGptSignInAttempt({ownerId:options.ownerId,hostId:options.hostId,redirectUri:`http://127.0.0.1:${port}/auth/callback`,previous:options.previous},dependencies); }
  catch (error) { server.close(); throw error; }
  const timer=setTimeout(()=>{if (!finished) {finish();rejectResult(new SignInError("EXPIRED"));}},timeoutMs);
  function finish():void { if (finished) return; finished=true; clearTimeout(timer); abort.abort(); if (activeResponse && !activeResponse.writableEnded) respond(activeResponse,400,"ChatGPT sign-in did not complete. You can close this window."); server.close(); }
  server.on("error",()=>{if (!finished) {finish();rejectResult(new SignInError("TOKEN_EXCHANGE_FAILED"));}});
  return {authorizationUrl:attempt.authorizationUrl,result,cancel:()=>{if (!finished) {finish();rejectResult(new SignInError("DECLINED"));}}};
}
