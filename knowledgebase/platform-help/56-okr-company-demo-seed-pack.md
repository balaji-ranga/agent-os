# OKR company demo seed pack

Administrators can install the **Northstar Industrial Supplies** demo to show Flolah's key differentiator: objectives and key results drive goals, multi-agent workflows, CRM/ERP evidence, CEO updates, policies, and per-agent budgets.

The pack creates a dedicated fictional Singapore distributor with a CEO, two synthetic human employees, eight AI employees, one annual and four quarterly objectives, seven multi-node workflows, seven Knowledge evidence tables, and optional live CRM / ERPNext mirrors. Twenty is the preferred CRM; when the platform cannot provision another isolated Twenty workspace, the pack automatically uses the tenant's ERPNext Sales CRM instead. It never deletes or reuses another tenant's workspace. It uses only reserved `.example` contacts.

The active Q3 objective measures revenue, qualified pipeline, DSO, and OTIF. The workflows explicitly carry objective and key-result identifiers, so a demo can start from the objective, inspect its goal/workflow evidence, and then ask the COO for the next action.

Action Control is intentionally autonomous for reads, internal writes, and synthetic external communications. Financial/destructive actions remain prohibited. Agent token and error budgets remain enforceable.

The pack is installed by an operator, not from the Company Setup UI. It supports Preview, Status, Seed, Cleanup, and Reseed. Cleanup is owner-confirmed and removes only exact pack-ledger resources. It keeps the CEO account and provider workspaces so the demo can be reseeded safely.

On the VPS, run the operator CLI from `/opt/agent-os/deploy` through the backend container:

```bash
docker compose exec -T backend npm run demo:northstar-okr -- --mode status --owner-email maya.tan@northstar-demo.example
docker compose exec -T backend npm run demo:northstar-okr -- --mode cleanup --owner-email maya.tan@northstar-demo.example --confirm-owner CEO_ID_FROM_STATUS
docker compose exec -T backend npm run demo:northstar-okr -- --mode reseed --owner-email maya.tan@northstar-demo.example
```

Run Status first and substitute its returned owner ID for `CEO_ID_FROM_STATUS`. A mismatched confirmation is rejected. These commands use the container's existing environment and must not be accompanied by copying or replacing `.env`.

WhatsApp pairing is not seeded because device sessions and credentials are private. After installing, pair the CEO's WhatsApp channel normally if the demo will be operated from WhatsApp.

For the exact commands, safety rules, inventory, verification, and rollback, use `knowledgebase/NORTHSTAR-INDUSTRIAL-OKR-DEMO-SEED-PACK.md`.
