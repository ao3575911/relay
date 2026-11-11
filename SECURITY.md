# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.2.0 | Yes |
| 0.1.0 | Prototype only |

## Scope of this repository

Version 0.2.0 is a single-host MVP. It can receive Telegram updates, store harnesses in PostgreSQL, and call the OpenAI Responses API when `OPENAI_API_KEY` is set. Tools are not executed. Sign in with ChatGPT is not connected to the bot.

The browser prototype is not a security boundary. Browser storage, demo callbacks, and fixture results are not authentication, isolation, or approval enforcement.

The bot's controls for this version are:

- `TELEGRAM_ALLOWED_USER_IDS`. Production (`NODE_ENV=production`) will not start without it. Users outside the list get a refusal and no workspace.
- `TELEGRAM_WEBHOOK_SECRET`, checked on webhook requests.
- One polling process per bot, held with a Postgres advisory lock.
- Tenant row-level security on owner-scoped tables.
- Fixed failure text for model errors. Credential-like model output is not stored.
- A run budget reservation and a timeout. The reservation is not a provider invoice, and a timed-out call is not repeated.

A passing test is not evidence that the live design in the technical specification is fully implemented.

## Reporting a vulnerability

Use GitHub private vulnerability reporting:

https://github.com/ao3575911/relay/security/advisories/new

If that form is unavailable, contact [@ao3575911](https://github.com/ao3575911) on GitHub. Do not open a public issue for a vulnerability, and do not include secrets, tokens, or personal chat data in the report.

Include the version, the file or document involved, and the impact you expect. The maintainer will acknowledge the report and agree a fix or a documentation change before any public mention.

There is no bug bounty.

## Secrets

Do not commit credentials. `.env` is gitignored. `.env.example` has empty values. CI does not read repository or environment secrets. The GitHub environment `production` holds `OPENAI_API_KEY` and `TELEGRAM_BOT_TOKEN` for a future deploy job and is not used by the current workflow.

If a secret is committed, revoke it at the provider and remove it from the git history with the maintainer. Deleting the file in a later commit does not remove it from history.
