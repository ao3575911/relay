# Agent notes

Relay 0.2.0 is a single-host Telegram MVP plus the offline prototype and the specifications for a larger service.

- Do not add secrets, tokens, credentials, `.env` files, or real chat exports. `.env.example` lists the variables with empty values.
- The browser prototype is not a security boundary. Do not describe the MVP as executing tools, enforcing provider invoices, or connecting Sign in with ChatGPT. Those are specified and are not wired to the bot.
- When `OPENAI_API_KEY` is set, a confirmed run calls the Responses API through `packages/chatgpt`. The model id lives in `OPENAI_MODEL` and defaults to `gpt-6-luna` in `apps/bot/src/config.ts`. Tests use mocks only. Do not call Telegram or OpenAI from CI.
- `TELEGRAM_ALLOWED_USER_IDS` is required when `NODE_ENV=production`.
- `prototype/core.mjs` owns the offline interaction model. `prototype/app.mjs` renders it. `scripts/build.mjs` writes `Relay-Prototype.html`. The bot domain lives in `packages/domain`.
- Keep the version at 0.2.0 in `package.json`, `README.md`, `CHANGELOG.md`, and `docs/` until the maintainer cuts a release. Do not create git tags or GitHub releases. The maintainer signs tags locally.
- Required checks: `npm run lint`, `npm run typecheck`, `npm test` (30 prototype tests and 93 TypeScript tests), `npm run build`, `python3 tests/contracts_checks.py` (19 schema checks), and `npm run validate`. Unit tests that need Postgres read `RELAY_TEST_DATABASE_URL`.
- `tests/browser_checks.py` is optional and is not part of CI. It is the only writer of `evidence/browser-results.json`.
- Change dialogue, the harness schema, tests, and the matching document together.
- Do not add a workflow that deploys or reads the `production` GitHub environment.
