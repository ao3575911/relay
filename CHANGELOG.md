# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-11

### Added

- Telegram bot with webhook and long-polling transports, a PostgreSQL store, and the harness control flow from the prelive tree.
- Responses API runs through `OPENAI_API_KEY`, with `OPENAI_MODEL` defaulting to `gpt-6-luna`. The scripted demo remains when no key is set.
- `TELEGRAM_ALLOWED_USER_IDS`. Production startup refuses to run without it. Other users receive a refusal and no workspace.
- `npm run telegram:set-webhook`, `telegram:delete-webhook`, and `telegram:webhook-info`.
- Startup checks for the environment variables in `.env.example`.
- A multi-stage Node 22 image and `docker-compose.yml` for the bot and Postgres.
- Deployment notes for a single host. No deploy workflow is included.

### Changed

- The service code replaces the 0.1.0 prototype layout where they overlap. The offline prototype, schema, and product documents stay.
- Version identifiers are 0.2.0.
- CI job `test` runs lint, typecheck, build, unit tests against Postgres, contract checks, and document checks. Actions are pinned by SHA. The workflow does not read secrets.

### Security

- Webhook requests must present `TELEGRAM_WEBHOOK_SECRET`.
- Model failures shown in Telegram are fixed sentences. Credential-like model output is withheld.
- A run reserves its harness budget before the provider call and does not automatically repeat a timed-out call.
- The production GitHub environment is documented only. CI does not use it.

## [0.1.0] - 2026-11-12

### Added

- Offline, button-led prototype of a Telegram-style agent-harness manager.
- Product requirements, technical specification, design blueprint, build plan, and validation notes.
- Versioned harness configuration schema, with 19 schema checks.
- 28 core behaviour tests for the interaction model.
- Contributor guide, security policy, and continuous integration for lint, tests, and document checks.

The maintainer signs release tags locally. This repository does not create tags or GitHub releases.

[Unreleased]: https://github.com/ao3575911/relay/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ao3575911/relay/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ao3575911/relay/blob/main/CHANGELOG.md
