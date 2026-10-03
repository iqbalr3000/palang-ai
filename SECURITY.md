# Security policy

## Supported versions

Only the latest `0.1.x` release of Palang AI and `@palang-ai/guards` receives security fixes.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub:
[Report a vulnerability](https://github.com/iqbalr3000/palang-ai/security/advisories/new).

Include the affected version, a minimal reproduction, and the impact you observed. Use synthetic
data only — never paste real NIK, NPWP, phone numbers, API keys or other personal data.

You can expect an acknowledgement within 7 days. Fixes are released as a patch version, and the
advisory is published once a fix is available, crediting you unless you prefer otherwise.

## Scope

In scope — please report privately:

- PII reaching the upstream unmasked because of a bug (not because of an unsupported format; see
  below), or vault values ending up in logs, audit rows or API responses.
- A way around an `enforce`-mode guard decision: a blocked tool call or canary leak that still
  reaches the client.
- Authentication or authorization bypass on the public API, admin API or dashboard.
- Leaking upstream API keys, the admin token or API keys.
- Denial of service from a single request (e.g. catastrophic regex backtracking).

Out of scope — a regular issue is fine:

- Prompt-injection detection misses and false positives. Detection is probabilistic; send the
  sample as a detection-quality issue.
- PII in formats the detector documents as unsupported.
- Deployments that ignore [`docs/deployment.md`](docs/deployment.md), e.g. exposing the admin API
  or dashboard publicly, or running with the demo's published secrets.
- Vulnerabilities in dependencies with no demonstrated impact on Palang.
