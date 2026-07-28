# Security Policy

## Supported versions

Theo Memory is **pre-release**. Security fixes land on the latest published version only; there
are no maintained backport branches yet. That will change when the project cuts `v1.0.0`.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it through GitHub's private vulnerability reporting on this repository
(**Security → Report a vulnerability**), which opens a channel visible only to the maintainers.

Include, as far as you can determine them:

- what the issue is and which component it affects (core, REST server, MCP server, CLI, Docker image);
- a reproduction — the smallest sequence of calls or configuration that triggers it;
- the impact you believe it has (data exposure across which boundary, privilege gained, and by whom);
- the version, commit, or image digest you tested.

We will acknowledge the report and tell you whether we can reproduce it. If we can, we will
agree a disclosure timeline with you before publishing. If we cannot, we will say so and explain
what we tried rather than letting the report go quiet.

## What is in scope

The boundaries this project is responsible for enforcing:

- **Workspace isolation** — a credential bound to one workspace reading or writing another's rows.
- **`(workspace, user)` isolation** — a user-scoped principal reading another user's session or
  agent memories.
- **Authentication and key lifecycle** — API-key verification, scope enforcement, OIDC
  introspection, key rotation and revocation, and the admin bootstrap path.
- **Secret handling** — credentials or memory contents leaking into logs, traces, error
  messages, or OpenTelemetry attributes.
- **Injection** into the SQL layer or the LLM extraction pipeline.
- **The published Docker image** and the dependency tree it ships.

## What is out of scope

- The security of *your* Postgres deployment, network, or reverse proxy.
- Denial of service through resource exhaustion on a self-hosted instance you control.
- Anything requiring an already-compromised host or database superuser.
- Findings from an automated scanner with no demonstrated exploit path — we will read them, but
  a report without a reproduction is triaged as a bug, not a vulnerability.

## A note on stored content

Theo Memory stores what you send it. It does not classify memory contents for sensitivity, and
`remember` is not a safe place for credentials. The Claude Code kit ships a secret-blocking hook
for exactly this reason, but the guarantee is best-effort — treat the memory store as being as
sensitive as the most sensitive thing you have written to it.
