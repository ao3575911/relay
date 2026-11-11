# 05 · Validation and build readiness

**10 November 2026 · prototype 0.1.0**

## Verified

| Check                  | Result                                                                      | Evidence                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Core behaviour         | 28 tests passed in the checked-in log                                       | [Node test output](../evidence/core-results.txt)                                                              |
| Configuration contract | 19 valid and invalid schema checks passed in the checked-in report          | [Schema report](../evidence/contracts-results.json)                                                           |
| Browser acceptance     | 20 scenarios are defined in the script. Their JSON report is not checked in | [Browser checks](../tests/browser_checks.py)                                                                  |
| Screenshots            | Home, approval, and mobile captures from the prototype workbench            | [Desktop](../evidence/desktop-home.png), [approval](../evidence/approval.png), [mobile](../evidence/mobile-home.png) |
| Source quality         | CI runs JavaScript syntax checks, Prettier 3.6.2, and Ruff 0.12.9           | Reproduction commands below                                                                                   |
| Offline bundle         | `npm run build` rewrites the standalone file from `prototype/`              | [Relay-Prototype.html](../Relay-Prototype.html)                                                               |

Core tests cover immutable versions, pinned runs, compare-and-swap conflicts, exact write approval, expiry, decline, replay, tampering, pause, bounded budgets, uncertain writes, delivery-only retry, invalid input, and malformed saved data. A seeded exploration checks rendering and persistence invariants over 1,170 transitions (18 rounds of 65 steps in `tests/core.test.mjs`).

The browser script drives buttons, input, downloads, refresh, wizard position, reset, keyboard access, storage denial, quota failure, and five injected failure scenarios. It also checks four viewport widths and an offline load of the standalone file. Running it writes `evidence/browser-results.json`. That report is not in this repository, and CI does not run the browser suite, so those scenarios are not recorded here as a pass. The checked-in screenshots show the workbench. Direct opening of the HTML file depends on the viewer's browser policy. The prototype is not a security boundary.

CI uses Node.js 22 and Python 3.12. Optional local checks install Playwright 1.62.0 and JSON Schema validator 4.26.0 from `requirements-dev.txt`, plus Ruff 0.12.9.

## Reproduce

From the package root:

```sh
npm ci
npm run lint
npm test
npm run validate
npm run build
python3 tests/contracts_checks.py
```

`npm run lint` checks JavaScript syntax, formats JS, CSS, HTML, and JSON with Prettier 3.6.2, and runs Ruff 0.12.9 on Python. `npm run validate` checks the 0.1.0 version string, the 28 and 19 counts, and relative documentation links.

For the optional browser suite, install `requirements-dev.txt` in a virtual environment, install Chromium through Playwright or set `RELAY_CHROMIUM_BIN` to an existing executable, then run:

```sh
python3 tests/browser_checks.py
```

The browser script starts and stops its own local test server. It writes `evidence/browser-results.json`, which is gitignored, so a local run does not become a recorded pass in git.

## Still required for the live bot

No Telegram registration, model calls, external writes, credentials, hosting, or production database were created. Authentication, isolation, real cost reservations, concurrency, durable receipts, SSRF controls, SDK integration, retention, deletion, native Telegram behaviour, and SLO or load testing remain milestone gates in [the build plan](04_BUILD_PLAN.md). Passing a local simulation does not establish those production guarantees. The prototype is not a security boundary.

**Ready to continue:** M0/M1 backend foundation and durable Telegram creation/configuration flow, using the fake runtime first.
