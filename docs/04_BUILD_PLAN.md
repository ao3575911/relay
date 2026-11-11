# 04 · Build plan and continuation handoff

**Planning estimate:** about six weeks for two engineers plus part-time design/QA, assuming managed infrastructure and a small invite-only pilot. This is sequencing guidance, not a delivery commitment. Build vertical slices; keep live side effects disabled until their release evidence passes.

Repository version 0.2.0. The estimate above is the original plan, not a claim about the current tree. The MVP that is in the repository is described in the [readme](../README.md).

## Implementation sequence

| Milestone                           | Work                                                                                                                                             | Exit evidence                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| M0 · Foundation, 1–2 days           | Pin Node/TypeScript/library versions; lockfile; CI; config validation; local PostgreSQL; secret references; structured redacted logging          | Clean build/lint/typecheck; schema fixtures; boot/readiness checks; no tracked credentials                                        |
| M1 · Telegram control, week 1       | grammY webhook; private-chat identity; durable inbox/outbox; owner-scoped repository; callback tokens; draft/create/detail/config/version/export | Two-tenant isolation tests; duplicate/out-of-order updates; old buttons; restart-safe draft and one version per commit            |
| M2 · Read-only runs, week 2         | Worker leases/fencing; runtime adapter; approved model catalogue; reservations; step/time/token limits; history/cancel                           | One bounded live read-only run after secure provider setup; usage reconciles; crash/restart; no tool execution from model text    |
| M3 · Tools and approvals, weeks 3–4 | SSRF-safe web fetcher; internal notes service; exact approvals; idempotent receipts; pause epochs; reconciliation                                | Approve/deny/expire/replay/tamper tests; pause races; write accepted then response lost; effect count stays one                   |
| M4 · Resilience and privacy, week 5 | Rate limits; delivery recovery; dependency outages; deletion/retention jobs; tracing hygiene; backup/restore                                     | Failure matrix exercised; restore drill; content purge; no secrets in logs/exports; measurable queue and reservation health       |
| M5 · Pilot, week 6                  | Telegram mobile/desktop UX; accessibility/localisation; load test; ten-user pilot; operational runbooks                                          | PRD usability targets assessed; all security blockers resolved; evidence ledger; operator can halt admission and reconcile safely |

M1 can proceed with a fake runtime. M2 adds the first real provider integration only after selecting credentials securely. Keys and bot tokens belong in environment secret settings, never Telegram or committed files.

## Suggested repository layout

```text
apps/bot/                 webhook, menus, payload rendering, delivery
apps/worker/              durable run loop, leases, reconciliation
packages/domain/          commands, state transitions, policy, money
packages/contracts/       config schema, validated command/event types
packages/storage/         migrations, owner-scoped queries, inbox/outbox
packages/runtime/         model adapter and bounded runner integration
packages/tools/           broker, fetcher, notes, receipt protocol
tests/{unit,integration,e2e,security,fixtures}/
ops/                      deployment, runbooks, restore/chaos scripts
```

## First coding slice

1. Read PRD → technical spec → blueprint. Keep [configuration schema](../contracts/harness.schema.json) as the v1 contract.
2. Extract pure validation/view conventions from `prototype/core.mjs`; preserve button labels and state semantics. Do not copy browser identity, readable callbacks, local storage or fixture accounting into the backend.
3. Implement owner, harness/version and draft migrations with tenant-scoped FKs and compare-and-swap commit. Add create → edit → review → new version using fake Telegram updates.
4. Add durable inbox/outbox and opaque callback bindings. Verify duplicate delivery produces one saved harness/version and re-rendering never starts a run.
5. Connect the transport adapter. In a private test bot, demonstrate creation and editing before adding a live model.

Recommended first build command set: `typecheck`, `lint`, `test:unit`, `test:integration`, `build`. Add a reproducible database seed and one documented development entry point. CI must not need production credentials.

## Acceptance trace

| Requirements    | Owning milestone | Required evidence beyond prototype                                                                        |
| --------------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| R01/R02/R07/R12 | M1, M5           | Durable drafts, CAS conflicts, native Telegram usability and accessible dialogue                          |
| R03/R05/R11     | M1, M3           | Two-user attacks, forged/replayed callbacks, payload/expiry binding, SSRF and tool-policy bypass attempts |
| R04/R06         | M2, M3           | Concurrent reservations, token bounds, lease takeover, pause/dispatch races, provider-cost uncertainty    |
| R08/R09         | M2, M4           | Worker crash after intent, lost receipts, Telegram 429/403/parse failures, restore/reconciliation         |
| R10             | M1, M4           | Secret-free exports, purge deadlines, revoked grants, deletion preserved through restore                  |

## Release gate

All required checks pass against the production build artifact. Release evidence includes: immutable config pinning; atomic quotas under concurrency; one effect under replay/crash; no cross-tenant access; denial under policy/database outage; approval/pause race outcomes; SSRF DNS/redirect/IPv6 cases; stale worker fencing; token/trace redaction; restart-safe delivery; deletion and restore drill; native-device walkthroughs. Critical or high unresolved security defects block live writes.

Define runbooks for `OUTCOME_UNKNOWN`, stuck reservations, provider outage, Telegram delivery backlog, bot-token rotation, database restore and emergency admission halt. Keep reconciliation and result retrieval available during an admission halt. Production launch also needs operator credentials, hosting selection and an actual bot registration; none were created in this phase.

## Decisions and next research

**Chosen:** private personal workspaces; one agent per harness; TypeScript; application-owned runtime; PostgreSQL source of truth; all-write approvals; curated tools; UTC quota days; managed provider for MVP; BYOK and scheduling deferred.

**Validate before implementation freezes:** name/handle availability; actual model/profile access and price catalogue; hosting/database/secret-manager selection; retention expectations; pilot users’ most valuable task templates. These do not block local backend scaffolding. Change decisions through a short ADR and update schema, requirements, tests and dialogue together.

**Completion rule for the next build:** ship M1 as a working, verified slice before expanding scope. The prototype is a reference and test asset, not a production backend.
