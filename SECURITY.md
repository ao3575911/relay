# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.0 | Yes |

## Scope of this repository

Version 0.1.0 is a local prototype and a specification. It does not connect to Telegram or a model provider. It stores no production data. The prototype is not a security boundary: browser storage, demo callbacks, and fixture results must not be treated as authentication, isolation, or approval enforcement.

The [technical specification](docs/02_TECHNICAL_SPEC.md) describes controls for a future live service. Those controls are not implemented here. A report about the specification is still useful. A passing local test is not evidence that the live design is safe.

## Reporting a vulnerability

Use GitHub private vulnerability reporting:

https://github.com/ao3575911/relay/security/advisories/new

If that form is unavailable, contact [@ao3575911](https://github.com/ao3575911) on GitHub. Do not open a public issue for a vulnerability, and do not include secrets, tokens, or personal chat data in the report.

Include the version, the file or document involved, and the impact you expect. The maintainer will acknowledge the report and agree a fix or a documentation change before any public mention.

There is no bug bounty.

## Secrets

Do not commit credentials. CI does not need production tokens. If a secret is committed, revoke it at the provider and remove it from the git history with the maintainer. Deleting the file in a later commit does not remove it from history.
