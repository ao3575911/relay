# 06 · Model connection options

**Status: repository version 0.2.0, 11 November 2026.** When `OPENAI_API_KEY` is set, a confirmed run calls the OpenAI Responses API. The default model is `gpt-6-luna`, from `OPENAI_MODEL` in `apps/bot/src/config.ts`. Tools are not sent. When the key is unset, the run stays the scripted demo. Sign in with ChatGPT is still not connected to the bot.

## ChatGPT account

OpenAI's [Sign in with ChatGPT quickstart](https://developers.openai.com/siwc/quickstart) describes optional use of eligible ChatGPT plan usage by supported apps without requiring users to provide an API key. Eligibility, available models and usage limits depend on the app, account and current OpenAI rules. A ChatGPT subscription by itself does not connect Relay; the user must explicitly sign in and authorize the relevant usage. The regular OpenAI API has separate credentials and billing.

The [Sign in with ChatGPT terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) require persistent authentication tokens to remain locally stored under the user's control. Plan-usage requests must originate in the user's local runtime or a remote runtime controlled only by that user. Requests must be for the authenticated user and their activity; background work requires express consent. Tokens and plan usage must not be shared or pooled. A generic managed multiuser Telegram server cannot be assumed to meet these conditions.

`packages/chatgpt/src/index.ts` implements an isolated model-list and streaming Responses transport for a future user-controlled runtime. It uses fixed OpenAI endpoints, requires an owner-bound session with direct plan-use scopes, sets `store: false` and `stream: true`, and fails if a stream does not complete. Mock tests cover the request contract, account mismatch, revocation, limits, cancellation and interrupted responses.

`signin.ts` and `local-signin.ts` implement the local OAuth/PKCE flow: loopback-only callback, one-time state and nonce, signature/issuer/audience/expiry checks via OpenAI's JWKS, consent-scope checks, and verified identity on reauthorization. Tokens stay in memory and are omitted from JSON serialization. This component has only been exercised using mock token responses and test signing keys; live sign-in is unverified. It intentionally discards refresh tokens, so the caller must reauthorize after expiry. The caller must retain the non-secret host ID and account/client registration locally to reuse them, and establish an explicit verified binding between the local account owner and Telegram user.

**The sign-in components are not connected to the Telegram worker.** `generateWithApiKey` is the method the worker calls, and it uses a platform API key rather than a ChatGPT plan session. The sign-in flow does not establish a user-controlled runtime, implement token renewal or revocation, execute tools, or pair a Telegram user to a ChatGPT account. Do not put ChatGPT tokens in the database, inbox, outbox, or logs. An API key in the bot environment is operator configuration, not end-user sign-in.

Next step: assess a personally controlled Relay runtime, its sign-in eligibility, registration requirements, license, consent and revocation UX against the current OpenAI documentation. Confirm that the proposed Telegram-to-runtime interaction is permitted before connecting it. Never ask for a ChatGPT password, session cookie or sign-in token in Telegram. Do not copy tokens into this managed development environment, the Relay database, inbox, outbox or logs. An approved integration is not yet available in this build.

## Grok account

[xAI's account FAQ](https://docs.x.ai/console/faq/accounts) says the same account can be used for Grok and the xAI API, but their billing is separate. An existing Grok subscription does not itself provision API access for Relay. No xAI integration or key is configured.

## Local model

A local, appropriately licensed model can avoid a provider API key when installed on suitable hardware. No model or inference server is currently installed. Before selecting one, verify model provenance and licensing, hardware fit, and output quality; keep tools disabled until runtime sandboxing and approval enforcement are in place.

## Runtime acceptance before release

1. Define provider identity and isolation, a real user consent flow, explicit connection status, disconnect/revocation and recoverable provider errors.
2. Implement durable run state, pinned configurations, cancellation, timeouts and idempotent recovery. Never replace a failed AI request silently with a scripted result.
3. Enforce spending, step, tool, network and approval policies in the execution boundary; define how limits map to subscription usage where dollar metering is unavailable.
4. Test account isolation, stale/duplicate callbacks, revocation, credential redaction, provider failures and Telegram delivery uncertainty before enabling real tasks.
