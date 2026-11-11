# 07 · Continue to a live bot

**Status: repository version 0.2.0, 11 November 2026.** The bot can run on one host with polling or a webhook. A confirmed run calls the Responses API when `OPENAI_API_KEY` is set, and otherwise stays scripted. Sign in with ChatGPT is not connected. Tools are not executed.

## Implemented

- Telegram webhook and long-polling ingestion share the same private-chat validation, callback hashing, credential-pattern redaction and durable inbox. Polling confirms a batch only after persistence, respects an existing webhook and uses a per-bot PostgreSQL advisory lock.
- Delivery uses a transactional outbox, owner-scoped operations, bounded cross-owner dispatch concurrency and explicit handling of ambiguous sends. The worker waits for its current cycle during shutdown.
- Personal ChatGPT components support an in-memory OAuth/PKCE attempt, loopback callback, verified ID-token claims, scope checks and text-only streaming Responses. Account registration and host IDs can be reused by a future caller. No credentials are saved by these components.
- With `OPENAI_API_KEY` set, the worker claims one pending run, calls the Responses API outside the database transaction, and stores a redacted result. The harness timeout is the request timeout. Output tokens are capped from the run budget using an assumed $30 per million output tokens. The full run budget is reserved against the daily cap and released if the run fails. This is not an invoice and not Sign in with ChatGPT.

## Required before real user tasks

1. Run on a machine or runtime controlled by the signed-in user. Establish and verify an explicit local binding between that user and the Telegram owner before enabling ChatGPT calls; accepting an owner ID as an argument is not verification. Provide an accessible sign-in, account status and disconnect experience.
2. Wire the verified session into an owner-scoped durable run workflow. Pin the harness version, require a reviewed task, impose concurrency and timeout limits, and handle failures and uncertain outcomes without silently repeating a paid or quota-consuming request.
3. Reconcile the existing dollar caps with ChatGPT plan or credit usage; do not claim to enforce a monetary limit the provider cannot verify. Keep tools disabled until approvals, sandboxing and network controls are independently enforced.
4. Add safe token renewal/revocation and user-controlled storage if persistent sessions are required. Preserve the host ID and the issued client/verified account mapping; do not store tokens on the shared server or in Telegram messages, inbox, outbox, logs or browser storage.
5. Address remaining operational gates: poison-update isolation without breaking per-owner ordering, retention/deletion, security review, real Telegram and provider integration tests, deployment monitoring and recovery.

## External prerequisites

Telegram requires a bot created through [BotFather](https://core.telegram.org/bots/features#botfather); this workspace has no bot token or connected Telegram account. ChatGPT requires an eligible account and explicit [Sign in with ChatGPT consent](https://developers.openai.com/siwc/quickstart); this workspace has no authorized session. The managed development environment also blocks outbound Telegram and OpenAI endpoints and is not the user's personal credential store. A persistent deployment and a suitable user-controlled runtime have not been provisioned.
