# Relay

[![CI](https://github.com/ao3575911/relay/actions/workflows/ci.yml/badge.svg)](https://github.com/ao3575911/relay/actions/workflows/ci.yml)
[![Release 0.1.0](https://img.shields.io/badge/release-0.1.0-123F37)](CHANGELOG.md)
[![MIT licence](https://img.shields.io/github/license/ao3575911/relay)](LICENSE)

Create an agent in a Telegram-style chat, choose its tools and limits, and manage every run with buttons.

## What it is

Relay 0.1.0 is a working local prototype of an agent-harness manager. A harness is one agent's instructions, model profile, tools, memory policy, and limits. Simple and Advanced modes use the same rules. You create a harness, review a draft, run a sample task, and approve or decline a simulated write.

Runs, costs, notes, and failures in the prototype are fixtures. The prototype is not a security boundary. Browser storage and demo callbacks are not production controls.

## Quickstart

Open [Relay-Prototype.html](Relay-Prototype.html) in a current browser. It runs offline and installs nothing.

To work from source you need Node.js 22 or newer. The preview server also uses Python 3. No credentials are required.

```sh
npm ci
npm test
npm run build
npm run preview
```

Open http://127.0.0.1:4173. `prototype/core.mjs` owns the interaction model, `prototype/app.mjs` renders it, and `npm run build` rewrites the standalone HTML file.

## Usage

In the bot panel, use **Create harness → Advanced → Research assistant → name → Create → Configure → Tools & access → Save notes → Back → Review changes → Apply → Run a task**. Approve or decline the proposed note. The panel on the right can inject a failure on the next run.

Use sample text. The demo may store its state in this browser. Reset is in that same panel.

## Documentation

The [documentation index](docs/index.md) is the entry point, including when GitHub Pages serves the `docs/` folder.

| Document | What it covers |
| --- | --- |
| [Product requirements](docs/01_PRD.md) | Scope, requirements, and acceptance |
| [Technical specification](docs/02_TECHNICAL_SPEC.md) | Live-service architecture, contracts, and failures |
| [Design blueprint](docs/03_DESIGN_BLUEPRINT.md) | Navigation, dialogue, and interaction rules |
| [Build plan](docs/04_BUILD_PLAN.md) | Implementation slices and release gates |
| [Validation](docs/05_VALIDATION.md) | What was checked, and what remains |
| [Configuration schema](contracts/harness.schema.json) | Versioned harness JSON, with an [example](contracts/harness.example.json) |

## Status

Version 0.1.0 is a working local prototype. Live Telegram and model integration are specified in the documents above and are not implemented. There is no production bot, provider account, or hosted backend in this repository.

The npm package is marked private. Use this repository rather than the npm registry. The maintainer signs release tags locally; this tree does not publish GitHub releases by itself.

## Licence

Released under the MIT licence. See [LICENSE](LICENSE).
