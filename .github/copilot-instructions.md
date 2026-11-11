# Copilot instructions

Relay 0.2.0 is a single-host Telegram MVP plus an offline prototype. Tools are not executed. Sign in with ChatGPT is not connected to the bot.

- Never add secrets, tokens, credentials, or `.env` files. Use sample text and mocks. Do not call Telegram or OpenAI from tests or CI.
- The browser prototype is not a security boundary. Do not treat browser storage, demo callbacks, or fixture runs as production controls.
- Preserve behaviour in `prototype/core.mjs`. Update tests and docs when dialogue, policy, or `contracts/harness.schema.json` changes.
- Leave the version at 0.2.0. Do not create git tags or GitHub releases.
- Before finishing, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run validate`, and `python3 tests/contracts_checks.py`. Postgres tests need `RELAY_TEST_DATABASE_URL`.
- Do not claim the optional browser suite passed unless `evidence/browser-results.json` was produced in that run. CI does not run it.
