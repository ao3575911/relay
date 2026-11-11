# Relay

[![CI](https://github.com/ao3575911/relay/actions/workflows/ci.yml/badge.svg)](https://github.com/ao3575911/relay/actions/workflows/ci.yml)
[![Release 0.2.0](https://img.shields.io/badge/release-0.2.0-123F37)](CHANGELOG.md)
[![MIT licence](https://img.shields.io/github/license/ao3575911/relay)](LICENSE)

Create an agent in Telegram, set its instructions and limits, and start a run with buttons.

## Status

Version 0.2.0 is a usable MVP. One process serves a private Telegram bot, stores harnesses in PostgreSQL, and, when `OPENAI_API_KEY` is set, sends a confirmed task to the OpenAI Responses API. Tools are not executed. Sign in with ChatGPT is implemented as a library and is not connected to the bot. Without an API key, the same buttons record a scripted demo.

The browser prototype is still the offline demo. The browser prototype is not a security boundary.

Checked on Node.js 22.23.4: `npm test` passed 30 prototype tests and 93 TypeScript tests (122 total). Twelve of the TypeScript tests use PostgreSQL. `python3 tests/contracts_checks.py` passed 19 schema checks. `npm audit` reported 0 vulnerabilities. Tests mock Telegram and OpenAI. No live provider call was made.

## Quickstart

### Docker Compose

Install Docker, copy the example environment, and set at least `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALLOWED_USER_IDS`. Compose runs the bot with `NODE_ENV=production`, which refuses to start without that allowlist.

```sh
cp .env.example .env
docker compose up --build
```

The bot service uses polling unless `TELEGRAM_TRANSPORT=webhook`. Postgres is only on the compose network. The password in the compose file is a local default.

### npm

Node.js 22 and PostgreSQL are required. Apply the migration, then start the bot.

```sh
npm ci
export DATABASE_URL=postgresql://relay:relay@127.0.0.1:5432/relay
export TELEGRAM_BOT_TOKEN=your-bot-token
export TELEGRAM_TRANSPORT=polling
npm run db:migrate
npm start
```

The offline prototype does not need a database:

```sh
npm test
npm run build
npm run preview
```

Open http://127.0.0.1:4173.

## Configuration

| Variable | Required | Purpose |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | yes | Bot token from BotFather |
| `TELEGRAM_TRANSPORT` | no | `polling` (default) or `webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | webhook | 32–256 characters; sent as Telegram `secret_token` |
| `PUBLIC_URL` | webhook registration | https origin with no path, for example `https://bot.example.com` |
| `TELEGRAM_ALLOWED_USER_IDS` | production | Comma-separated numeric Telegram user IDs. Other users get a refusal and no workspace |
| `DATABASE_URL` | yes | Postgres connection string |
| `OPENAI_API_KEY` | no | When set, runs call the Responses API. When unset, runs stay scripted |
| `OPENAI_MODEL` | no | Model id. Default `gpt-6-luna` |
| `PORT` | webhook | Listen port. Default `3000` |
| `HOST` | no | Listen address. Default `127.0.0.1` |
| `NODE_ENV` | no | `production` refuses to start when the allowlist is unset |

`npm run telegram:set-webhook` registers `PUBLIC_URL/telegram/webhook` with `secret_token` set to `TELEGRAM_WEBHOOK_SECRET`. `npm run telegram:delete-webhook` removes it. `npm run telegram:webhook-info` prints the current URL and pending update count. Polling is the simple mode for a single host. Polling refuses to start while a webhook is still registered.

## Security

Set `TELEGRAM_ALLOWED_USER_IDS` before anyone else can message the bot. In production the process exits if that list is missing. Outside production it logs a warning and accepts every user.

The webhook secret is checked with a hash comparison. Do not log or commit tokens, API keys, or `DATABASE_URL`. CI does not read repository or environment secrets. A GitHub environment named `production` already holds `OPENAI_API_KEY` and `TELEGRAM_BOT_TOKEN` for a later deploy job. This repository does not deploy.

Model errors returned to Telegram are fixed sentences. Provider bodies and credentials are not stored in the run record. Output is capped, and a credential-like answer is withheld. The run budget is an upper-bound reservation using an assumed $30 per million output tokens, not a provider invoice. A more expensive model can cost more than the harness budget. Daily reservation resets by UTC date. Failed runs release the reservation. A timed-out run is not sent again.

Row-level security in Postgres scopes tenant tables to the current owner. The browser prototype is not a security boundary.

## Documentation

The [documentation index](docs/index.md) is the entry point for GitHub Pages from `/docs`.

| Document | What it covers |
| --- | --- |
| [Deploy](docs/DEPLOY.md) | Polling on one host, webhooks behind HTTPS, and the unused production environment |
| [Product requirements](docs/01_PRD.md) | Scope, requirements, and acceptance |
| [Technical specification](docs/02_TECHNICAL_SPEC.md) | Live-service architecture, contracts, and failures |
| [Design blueprint](docs/03_DESIGN_BLUEPRINT.md) | Navigation, dialogue, and interaction rules |
| [Build plan](docs/04_BUILD_PLAN.md) | Implementation slices and release gates |
| [Validation](docs/05_VALIDATION.md) | What was checked, and what remains |
| [Model connections](docs/06_MODEL_CONNECTIONS.md) | API key runs and the unwired ChatGPT sign-in flow |
| [Continuation](docs/07_CONTINUATION.md) | What the bot does now, and what is still open |
| [Configuration schema](contracts/harness.schema.json) | Versioned harness JSON, with an [example](contracts/harness.example.json) |

## Licence

Released under the MIT licence. See [LICENSE](LICENSE).
