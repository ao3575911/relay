---
layout: default
title: Relay
---

# Relay

Create an agent in a Telegram-style chat, choose its tools and limits, and manage every run with buttons.

Version 0.1.0 is a working local prototype. Live Telegram and model integration are specified in these documents and are not implemented. The prototype is not a security boundary.

## Documents

- [Product requirements](01_PRD.md) — scope, requirements, and acceptance.
- [Technical specification](02_TECHNICAL_SPEC.md) — architecture, data, approvals, and failures for the live service.
- [Design blueprint](03_DESIGN_BLUEPRINT.md) — screens, dialogue, and the preview workbench.
- [Build plan](04_BUILD_PLAN.md) — ordered slices from this prototype to a pilot.
- [Validation](05_VALIDATION.md) — 28 core tests, 19 schema checks, and the checks that are still open.

## Prototype

The runnable files live in the repository root, next to this `docs/` folder.

- [Standalone prototype](../Relay-Prototype.html)
- [Source preview](../prototype/index.html)
- [Harness schema](../contracts/harness.schema.json) and [example](../contracts/harness.example.json)
- [Project readme](../README.md)

Serve this folder with GitHub Pages from the `docs/` directory on `main`. These pages describe the prototype and the specified live service. They are not a deployed bot.
