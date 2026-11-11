# 01 · Product requirements

**Relay 0.1.0 · 10 November 2026 · proposed build baseline**

## Product

A Telegram management platform for personal AI agent harnesses. A **harness** combines agent instructions, model selection, tools, memory policy and execution limits. A **run** executes one task against an immutable harness version. An **approval** permits one exact proposed action.

**Promise:** “Build your agent. Set its boundaries. Stay in control.”

Version 0.1.0 of this repository is an offline prototype. Live Telegram connectivity and model calls are requirements in this document. They are not implemented.

The first release serves individuals in private bot chats. Simple mode reduces setup; Advanced mode exposes more configuration. Both use the same policy engine. Defaults are product decisions for this build, not validated market findings.

## Users and jobs

| User                       | Job                                               | Successful outcome                                    |
| -------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| Newcomer                   | Make a useful assistant without learning commands | Creates and runs a preset within three minutes        |
| Builder                    | Tune behaviour, model, tools and limits           | Reviews a versioned configuration and can restore it  |
| Privacy-conscious operator | Understand and contain agent actions              | Sees exact write previews, spending and stop controls |

## Release scope

**MVP:** one agent per harness; multiple personal harnesses; guided creation; editable instructions/model profiles; curated web reading and private notes; per-run and daily limits; temporary memory; manual runs; approvals; pause; versions; export; history; deletion and operational recovery.

**Next:** secure BYOK/provider connections, reviewed JSON import, opt-in persistent memory, schedules with explicit timezone and DST rules, richer knowledge sources, Mini App editor.

**Later:** bounded multi-agent graphs, third-party write connectors, isolated custom tools. Shell execution, arbitrary MCP servers, payments and public/group control are excluded from MVP. Personalisation never grants an unreviewed capability.

## Requirements and acceptance

| ID  | Requirement                   | Acceptance condition                                                                                                    |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| R01 | Button-led creation           | Simple/Advanced → template → name → review → create; Back and draft recovery work                                       |
| R02 | Individual behaviour          | Instructions and model profile change in a draft; review shows the diff; commit creates a new version                   |
| R03 | Fine-grained access           | Web domains and note access are explicit; denied capabilities remain denied under adversarial prompts                   |
| R04 | Bounded execution             | Reserve budget before work; enforce step, active-time and daily caps; record actual/unknown usage                       |
| R05 | Human approval                | Exact tool, destination, content and expiry shown; decline, expiry, replay or changed payload cannot write              |
| R06 | Run control                   | Review task before starting; report state/result; cancel and pause block new work at the broker boundary                |
| R07 | Safe change management        | Running tasks retain pinned versions; restoring creates a new version; concurrent edits cannot silently overwrite       |
| R08 | Recovery                      | Provider errors, stale menus, delivery failures and uncertain writes offer valid next steps without blind write retries |
| R09 | Understandable history        | Run ID, version, status, usage and redacted action trail are available after restart and delivery failure               |
| R10 | Portability and privacy       | Export excludes credentials/history; live deletion stops work, revokes access and purges content on schedule            |
| R11 | Tenant isolation              | Every operation checks the authenticated Telegram numeric user ID and resource owner; cross-user references fail        |
| R12 | Friendly, accessible dialogue | Short messages, descriptive buttons, text status alongside colour, no required slash commands beyond starting           |

## Default policy

Simple starts with the Balanced model profile, web/notes off, memory off, USD $0.50/run, $5/day per harness, eight total runtime steps and 90 seconds of active runtime. Approval expires after ten minutes. Day boundaries are 00:00 UTC and are stated in Spending. A separate operator-set account cap limits aggregate exposure across harnesses.

Advanced can select Fast/Balanced, instructions, curated tools, public domain allowlist, temporary scratchpad, $0.50/$1/$2 run caps, $5/$10 daily caps, 4/8/12 steps and 30/90/180 active seconds. These are initial catalogue choices. Policy ceilings and all-write approval remain enforced. Simple view preserves existing Advanced settings and shows their effective values.

The live MVP uses operator-managed provider access. Users do not submit API keys in Telegram. Pricing and model mappings come from an operator-approved catalogue; the prototype charges nothing.

## Pilot targets and economics

Targets, not measured results: ≥80% of ten first-time pilot users create and complete a sample run unaided; median setup ≤3 minutes; ≥90% correctly identify the approved action and maximum spend. Record task success separately from onboarding completion.

Service targets: p95 callback acknowledgement <1 second; p95 configuration response <800 ms excluding Telegram delivery; ≥99.5% monthly control-plane availability after pilot hardening. No duplicate note effects or unauthorised writes in the release suite. No absolute “error-free” claim: safe failure means refusing unsafe work, preserving state and explaining recovery.

Pilot billing stays disabled. Record provider cost + tool cost + infrastructure allocation per completed run and cost per retained user. Propose paid quotas only after measured unit costs and interviews; do not invent a subscription price now.

## Prototype coverage

R01–R09 and R12 are demonstrated with fixtures. Export in R10 is implemented locally. R03–R08 checks exercise a simulation, not real service guarantees. Authentication/isolation, durable execution, actual model quality, deletion jobs and operational SLOs require the live build. See [validation](05_VALIDATION.md) for evidence and [technical specification](02_TECHNICAL_SPEC.md) for enforcement.
