# Deploy

Repository version 0.2.0. This is a single-host runbook. It does not select a paid platform and it does not add a workflow that pushes a deploy.

## Polling on one machine

Polling is the simple mode. Run one bot process. A second process cannot take the Postgres advisory lock for the same bot.

1. Create a bot with BotFather and copy the token into `.env` as `TELEGRAM_BOT_TOKEN`. Do not commit `.env`.
2. Set `TELEGRAM_TRANSPORT=polling`.
3. Set `TELEGRAM_ALLOWED_USER_IDS` to the numeric Telegram user IDs that may talk to the bot. `NODE_ENV=production` exits if this is empty.
4. Start Postgres and set `DATABASE_URL`.
5. Apply migrations and start the process: `npm run db:migrate` then `npm start`. Docker Compose does both. See the [readme](../README.md).

Leave `OPENAI_API_KEY` unset to keep scripted replies. Set it, and optionally `OPENAI_MODEL`, to call the Responses API. The default model is `gpt-6-luna`.

The compose file publishes port 3000. Polling does not need that port. Do not publish the Postgres port.

## Webhook behind HTTPS

Telegram must reach a public HTTPS URL. Terminate TLS in front of the bot, then proxy to `HOST` and `PORT` (compose uses `0.0.0.0` and `3000`). The path is `/telegram/webhook`.

1. Set `TELEGRAM_TRANSPORT=webhook`.
2. Set `TELEGRAM_WEBHOOK_SECRET` to 32–256 characters from `A–Z`, `a–z`, `0–9`, `_`, and `-`.
3. Set `PUBLIC_URL` to the https origin with no path, such as `https://bot.example.com`.
4. Start the bot so it is listening.
5. Register the webhook:

```sh
npm run telegram:set-webhook
```

That call sets `secret_token` to `TELEGRAM_WEBHOOK_SECRET`. Check it with `npm run telegram:webhook-info`. Remove it with `npm run telegram:delete-webhook` before switching back to polling. Polling will not start while a webhook is registered.

## GitHub environment

A GitHub environment named `production` already exists and holds `OPENAI_API_KEY` and `TELEGRAM_BOT_TOKEN`. A future deploy job can use that environment. This repository does not reference those secrets, and CI does not either.

The browser prototype is not a security boundary. The bot's allowlist, webhook secret, and database policies are the controls for this MVP. They do not execute tools or turn the harness budget into a provider invoice.
