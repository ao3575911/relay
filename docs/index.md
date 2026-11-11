---
layout: default
title: Relay
---

# Relay

Create an agent in Telegram, set its instructions and limits, and start a run with buttons.

Version 0.2.0 is a usable MVP: a Telegram bot, PostgreSQL, and an optional OpenAI Responses API call. Tools are not executed. Sign in with ChatGPT is not connected to the bot. The browser prototype is not a security boundary.

`npm test` for this version passed 30 prototype tests and 93 TypeScript tests. Schema checks passed 19 cases. Those counts are from the 0.2.0 check recorded in [validation](05_VALIDATION.md).

## Documents

- [Deploy](DEPLOY.md) — polling on one host, webhooks behind HTTPS, and the unused production environment.
- [Product requirements](01_PRD.md) — scope, requirements, and acceptance.
- [Technical specification](02_TECHNICAL_SPEC.md) — architecture, data, approvals, and failures for the live service.
- [Design blueprint](03_DESIGN_BLUEPRINT.md) — screens, dialogue, and the preview workbench.
- [Build plan](04_BUILD_PLAN.md) — ordered slices from this prototype to a pilot.
- [Validation](05_VALIDATION.md) — 30 core tests, 93 TypeScript tests, 19 schema checks, and the checks that are still open.
- [Model connections](06_MODEL_CONNECTIONS.md) — API key runs and the unwired ChatGPT sign-in flow.
- [Continuation](07_CONTINUATION.md) — what the bot does now, and what is still open.

## Prototype

The runnable files live in the repository root, next to this `docs/` folder.

- [Standalone prototype](../Relay-Prototype.html)
- [Source preview](../prototype/index.html)
- [Harness schema](../contracts/harness.schema.json) and [example](../contracts/harness.example.json)
- [Project readme](../README.md)

Serve this folder with GitHub Pages from the `docs/` directory on `main`. These pages describe the MVP and the specified live service. They are not a deployed bot.
