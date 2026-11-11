# Agent notes

Relay 0.1.0 is a local, offline prototype of a Telegram-style agent-harness manager, plus the specifications for a later live service.

- Do not add secrets, tokens, credentials, `.env` files, or real chat exports.
- The prototype is not a security boundary. Do not describe it as a production backend or a live Telegram or model connection. Those integrations are specified and are not implemented.
- `prototype/core.mjs` owns the interaction model. `prototype/app.mjs` renders it. `scripts/build.mjs` writes `Relay-Prototype.html`.
- Keep the version at 0.1.0 in `package.json`, `README.md`, `CHANGELOG.md`, and `docs/` until the maintainer cuts a release. Do not create git tags or GitHub releases. The maintainer signs tags locally.
- Required checks: `npm run lint`, `npm test` (28 core tests), `python3 tests/contracts_checks.py` (19 schema checks), and `npm run validate`.
- `tests/browser_checks.py` is optional and is not part of CI. It is the only writer of `evidence/browser-results.json`.
- Change dialogue, the harness schema, tests, and the matching document together.
