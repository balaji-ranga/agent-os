# Chat action approval lifecycle

The built-in `notify_ceo` tool only writes an entitled CEO's in-app notification.
It is R1 / write_internal. External email, WhatsApp and publishing remain R2;
explicit CEO risk overrides and intentional internal-write approval policies remain effective.

On authenticated company Kanban/notification reads and approval use, expired grants
become terminal and their exact generated approval tasks are removed from Kanban.
Obsolete default-policy notify_ceo approvals are superseded without replay.
Approval records and removed task/message snapshots remain in internal
`chat_action_approval_task_archive`, allowing audit/recovery without exposing
arguments to the UI. Executed/rejected cards, unbound/manual tasks and linked
goal/delegation work are not removed. No cleanup executes or rearms an action.

Local tests:

- backend: `npm run test:notify-approval`
- frontend: `npm run test:action-approval`, `npm run test:chat`, `npm run build`

Clean Docker builds include these files through the existing backend/frontend
Dockerfiles. Focused VPS rollout uses `deploy/scripts/vps-deploy-approval-lifecycle.sh`
with APPROVAL_PATCH and a unique RELEASE_REVISION. It checks the reviewed patch
against both deployed source and checkout, gates regression/build tests, detects
parallel changes and captures rollback images before replacing only backend/frontend.
It preserves Compose overlays and does not replace OpenClaw, Knowledge workers,
tenant volumes or trading settings.

Optional explicitly scoped live verification/cleanup:
`node scripts/vps-test-notify-approval-live.mjs --cleanup --owner-name "Balaji Ranganathan"`.
This uses a temporary session (revoked afterward), checks deployed Kanban/bell APIs
and denied stale approval, and verifies archived removals with no notification replay.
It never approves a valid action. Cleanup is recoverable from retained archive rows;
restoring an audit snapshot must never reactivate an expired authorization.
