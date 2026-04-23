# Security

## Reporting a vulnerability

If you find something that looks like a security issue — anything that
would let an attacker read or modify another user's HA inventory,
execute code in the container, exfiltrate tokens, or mislead the
enrichment pipeline into downloading malicious content — please do not
open a public issue.

Email: **hello@archgate.dev**

Include a proof-of-concept if possible. I'll acknowledge within a
reasonable window (this is a side project, not a company — expect days,
not hours).

## Scope

Things in scope:

- Code in this repository (`house-inventory/src/**`, the Dockerfile, the
  add-on manifest).
- The interaction between the add-on and the HA Supervisor API.
- The PDF-download and LLM-prompt pipeline.

Things out of scope:

- Vulnerabilities in Home Assistant itself (report to
  [Home Assistant security](https://www.home-assistant.io/security/)).
- Vulnerabilities in Bun, Hono, or any third-party dependency (report
  upstream).
- The user's chosen LLM provider (OpenRouter, OpenAI, etc.).

## Data handling

The add-on stores everything under HA's per-add-on `/data` volume:

- SQLite with device metadata, user-entered purchase / warranty / notes
- Downloaded manual PDFs

No telemetry leaves the add-on. The only outbound network traffic is:

- To your configured Home Assistant instance (service calls, WebSocket
  registry).
- To DuckDuckGo's HTML search endpoint (enrichment).
- To manufacturer sites or `manualslib`/similar, to download manual PDFs
  returned by the LLM.
- To your configured LLM provider (via HA's AI Task / conversation
  service, not directly).

No credentials are written to disk — the Supervisor token is injected
by HA at runtime.
