# Contributing

Relay 0.1.0 is a local prototype and a set of specifications. Issues and pull requests are welcome. Please keep changes small and describe the behaviour you are changing.

## Ground rules

- Do not commit secrets, tokens, credentials, or real chat exports. Use sample text.
- The prototype is not a security boundary. Do not present it as a production backend or a live Telegram connection.
- Keep the published version at 0.1.0 until the maintainer prepares a release. Do not add git tags or GitHub releases in a pull request. The maintainer signs tags locally.
- Use conventional commits: `feat`, `docs`, `ci`, and `chore`.
- Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public issue.

## Setup

Node.js 22 or newer, Python 3.12, and git. From a clean checkout:

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

`.venv/` is gitignored. Application code has no runtime dependency.

## Checks

```sh
npm run lint
npm test
npm run validate
python3 tests/contracts_checks.py
npm run build
```

`npm test` runs 28 core tests. The schema script runs 19 checks. `npm run validate` checks version 0.1.0, those counts, and relative links in the documents.

The browser suite is optional and is not part of CI:

```sh
python3 tests/browser_checks.py
```

Set `RELAY_CHROMIUM_BIN` if Playwright should use an existing Chromium. The script writes `evidence/browser-results.json`.

## Product changes

Read the [requirements](docs/01_PRD.md), [technical specification](docs/02_TECHNICAL_SPEC.md), and [design blueprint](docs/03_DESIGN_BLUEPRINT.md) before changing dialogue or policy. `prototype/core.mjs` is the interaction model. If you change a button label, a state, or the harness schema, update the tests and the documents in the same pull request.

## Pull requests

Fill in the pull request template. Say which checks you ran. The CI job `test` must pass. A review from @ao3575911 is required before merge; do not merge your own pull request unless you are the maintainer.
