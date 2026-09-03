# Gmail connector quota failure — 4 September 2026

## Verified cause

A read-only reproduction for the affected CEO returned successful recent-mail
and spam pages, followed by HTTP 403 from Gmail for promotions. The original
provider message identified **Total Query Cost / Units per minute per user**.
This was not a missing OAuth connection or a different CEO's credentials.

OpenConnector maps all provider 403s to `authorization_failed`. Flolah then
retried every HTTP action failure over MCP. That fallback returned the misleading
`Connect gmail with OAuth first` message, masking the real quota failure and
triggering ineffective authentication retries.

Google's current documentation lists 20 units per message read and 6,000 units
per minute per user for new-quota projects. Effective quotas may differ by project:
https://developers.google.com/workspace/gmail/api/reference/quota

## Source changes

- Preserve structured provider status, error code and Retry-After. Normalize
  rate/quota failures before authentication handling; never call these missing OAuth.
- Negotiate legacy MCP only for an unavailable HTTP route, not executed provider
  errors, timeouts, quota failures or writes with unknown outcomes.
- Split `gmail.fetch_emails` into 25-message pages while preserving its input,
  output envelope, next-page token, requested limit and exact owner alias.
- Reserve a conservative 4,000 units/minute read budget in SQLite, keyed by CEO
  and connection. Reservations survive backend restarts and concurrent callers.
  Expired reservations are pruned on use. Other clients sharing a mailbox can
  still consume quota; the provider remains the final authority.
- Retry a rate-limited read page once after a bounded cooldown. Do not restart
  successful pages for a rate limit, loop indefinitely, or replay writes.
- Connector operation default: 300 seconds, configurable in Admin Timeouts.
  The OpenClaw outer request receives the tool timeout plus transport headroom.
  Ordinary tool defaults are unchanged; existing explicit behaviour overrides
  continue to take precedence.

## Deployment and rollback

Rollback checkpoint: `rollback/gmail-connector-20260904` at `5dd0769`.
Rebuild backend and OpenClaw from the committed source; the existing OpenClaw
entrypoint installs the versioned extension. No edits inside running containers.
No OAuth credentials, Google settings, mailbox contents or unrelated services
are changed by deployment.

Configuration is documented in `deploy/.env.example` and passed by Compose:
`GMAIL_READ_QUOTA_UNITS_PER_MINUTE`, `CONNECTOR_OPERATION_TIMEOUT_MS`.

## Focused verification

- `node backend/scripts/test-connector-execution-policy.mjs`: provider error
  fidelity, genuine 401/403, daily quota vs rate limits, Retry-After, bounded
  retries, no write replay, HTTP/MCP negotiation, pagination, malformed pages,
  owner aliases, independent reservation keys, and configurable timeout.
- `node backend/scripts/test-gmail-mailbox-operations.mjs`: review, scoped cleanup
  plan, action grants and existing partial-cleanup behavior using synthetic data.
- `node backend/scripts/test-tool-execution-governor.mjs`: existing focused governor checks.

Live verification must use the affected CEO's agent and a read-only mailbox
review. Do not send, trash, label or draft emails as part of this verification.
Passing unit tests alone does not establish live agent success.
