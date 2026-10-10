# Contextual connector selection

`connector_search_actions` is agent action discovery, not the connector-palette app search. It returns canonical `actions[].action_id`, schemas, relevance, owner availability and existing action-grant status. The app palette continues to use `searchConnectorApps`.

Discovery covers the owner's configured connections and public no-key Hacker News. It does not create credentials or grants. Public-news access for an explicitly scoped agent is an opt-in administrative operation:

```sh
docker exec agent-os-backend-1 node scripts/grant-public-news-actions.mjs OWNER AGENT --apply
```

This requires an existing action allowlist and matching owner. It adds only `hackernews.get_latest_posts`, `hackernews.search_posts`, and `hackernews.get_item`, preserving all other grants. No global/all-tenant news grants are seeded. Existing Action Control still applies.

Before rollout run:

```sh
cd backend
node scripts/test-connector-discovery.mjs
node scripts/test-connector-execution-policy.mjs
node scripts/test-gmail-mailbox-operations.mjs
node scripts/test-action-policy-autonomy.mjs
node scripts/test-agent-command-routes.mjs
```

For a scoped VPS update, capture the running image/source, apply only reviewed changes to that capture, and use `deploy/docker/backend.scoped-update.Dockerfile` with an explicit rollback `BASE_IMAGE`. Include the workspace templates and opt-in script. Do not reset a dirty VPS checkout. Activate only after checking in-flight work. Standard full builds already include backend scripts and workspace templates.

Acceptance: submit a read-only AI-news request without naming a connector; verify the agent discovers Hacker News, reads the chosen guide and executes a real canonical action. Check the tool ledger as well as chat links/dates. Confirm Gmail sending is still denied. Never use `_execution.action_id` / `tea-*` tracking IDs as connector actions.
