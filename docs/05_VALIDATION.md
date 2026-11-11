# 05 · Validation and build readiness

**11 November 2026 · repository version 0.2.0**

The 0.2.0 check passed type checking, lint, build and the test suite: 30 browser-prototype core tests and 93 TypeScript tests, including 12 PostgreSQL integration tests. The PostgreSQL tests ran against a disposable local database using a non-superuser application role. ChatGPT sign-in tests and Responses API tests use mocks only. Telegram polling tests use a fake API and real disposable PostgreSQL. `npm audit` reported 0 vulnerabilities. No live OpenAI request and no deployed Telegram bot were tested. The browser scenarios below were not re-run for 0.2.0; the checked-in report is from the earlier prototype pass.

## Verified

| Check                  | Result                                                                      | Evidence                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Core behaviour         | 30 tests passed                                                             | [Node test output](../evidence/core-results.txt)                                                              |
| Configuration contract | 19 valid/invalid schema checks passed                                       | [Schema report](../evidence/contracts-results.json)                                                           |
| Browser acceptance     | 20 scenarios passed                                                         | [Browser report](../evidence/browser-results.json)                                                            |
| Browser runtime        | No uncaught page errors; no external requests in tested flows               | Same browser report                                                                                           |
| Responsive layout      | No horizontal overflow at 320, 390, 768 and 1440 px; bot buttons ≥44 px     | Browser scenarios; [mobile](../evidence/mobile-home.png) and [desktop](../evidence/desktop-home.png) captures |
| Source quality         | JavaScript syntax checks, Prettier formatting and Python Ruff checks passed | Reproduction commands below                                                                                   |
| Offline bundle         | Rebuilt from source; creation works after browser networking is disabled    | Standalone browser scenario                                                                                   |

Core tests cover immutable versions, pinned runs, compare-and-swap conflicts, exact write approval, expiry/decline/replay/tampering, pause, bounded budgets, uncertain writes, delivery-only retry, invalid input and malformed saved data. A seeded exploration checks rendering and persistence invariants over 1,170 transitions.

Browser checks exercise actual buttons, input, downloads, refresh, wizard position, reset, keyboard access, storage denial/quota failure and five injected failure scenarios. [Approval capture](../evidence/approval.png) shows the exact write preview.

Environment used: Node.js 24.19.0, Python 3.12.14, Playwright 1.62.0, Chromium 154.0.8037.57, JSON Schema validator 4.26.0. The managed browser blocks `file://` navigation by policy. The self-contained bundle was tested over a local HTTP preview, then used with networking disabled. Direct double-click opening remains dependent on the viewer’s browser policy.

## Reproduce

From the package root:

```sh
npm test
npm run build
node --check prototype/core.mjs
node --check prototype/app.mjs
node --check scripts/build.mjs
node --check tests/core.test.mjs
```

For optional browser/schema checks, install `requirements-dev.txt` in a virtual environment, install Chromium through Playwright or use an existing Chromium, then run:

```sh
python3 tests/contracts_checks.py
python3 tests/browser_checks.py
```

`RELAY_CHROMIUM_BIN` can select an existing browser executable. The browser script starts and stops its own local test server. Formatting used Prettier 3.6.2 for JS/CSS/HTML/JSON/Markdown and Ruff 0.12.9 for Python.

## Still required for the live bot

No Telegram registration, model calls, external writes, credentials, hosting or production database were created. Authentication/isolation, real cost reservations, concurrency, durable receipts, SSRF controls, SDK integration, retention/deletion, native Telegram behaviour and SLO/load testing remain milestone gates in [the build plan](04_BUILD_PLAN.md). Passing a local simulation does not establish those production guarantees.

**Ready to continue:** extend the backend foundation with a real, authorized model integration and independently enforce runtime policies. The current backend demo records a fixed example response; it is not an agent runtime.
