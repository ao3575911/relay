# Copilot instructions

Relay 0.1.0 is an offline prototype. Live Telegram and model integration are specified in `docs/` and are not implemented.

- Never add secrets, tokens, credentials, or `.env` files. Use sample text only.
- The prototype is not a security boundary. Do not treat browser storage, demo callbacks, or fixture runs as production controls.
- Preserve behaviour in `prototype/core.mjs`. Update tests and docs when dialogue, policy, or `contracts/harness.schema.json` changes.
- Leave the version at 0.1.0. Do not create git tags or GitHub releases.
- Before finishing, run `npm run lint`, `npm test`, `npm run validate`, and `python3 tests/contracts_checks.py`.
- Do not claim the optional browser suite passed unless `evidence/browser-results.json` was produced in that run. CI does not run it.
