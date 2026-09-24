# OpenClaw credential broker and rotation

## Security boundary

OpenClaw agents never receive a long-lived Flolah tool credential in prompts or tool schemas. The
`agent-os-content-tools` plugin authenticates to a private broker endpoint with a process-level
bootstrap secret and obtains a short-lived `ftl_` lease for exactly one owner, caller agent,
OpenClaw session, and tool name. The backend repeats owner, agent-grant, session, and tool checks on
the actual `/api/tools/invoke` call.

Ordinary tenant agents receive read-only access constrained by `tools.fs.workspaceOnly=true`; they
do not receive filesystem mutation or command tools (`write`, `edit`, `apply_patch`, `exec`, or `process`). Workspace instructions continue to be loaded by OpenClaw and
all Flolah content tools, delegation tools, workflow tools, browser APIs, and session coordination
tools remain available according to each agent's grants.

## Rotation

Admin → AgentSystem recovery → Security credentials is protected by the existing privileged OTP
session. It supports:

- Tool broker rotation: takes effect immediately and revokes outstanding short-lived leases.
- AgentSystem gateway token rotation: updates the protected shared runtime store and gateway config,
  then restarts only the OpenClaw container. On restart failure, the previous token is restored.
- Legacy `ftc_` cleanup: revokes legacy database hashes and removes the shared credential file.

Secret values are never returned by the API, rendered in the UI, or written to audit details.
Provider-issued and connector-issued credentials remain replaceable at their issuing provider or
existing connector/vault UI; the recovery screen reports only whether deployment-managed values are
configured.

## Compatibility and rollback

`TOOLS_LEGACY_FTC_ENABLED=1` is an emergency rollback switch. Production defaults to disabled and
`TOOLS_LEGACY_FTC_PURGE_ON_START=1`. A rollback must restore the matching source/image and OpenClaw
volume together; do not restore only `openclaw.json` from a different image version.

Before this migration, a protected VPS-only snapshot was taken containing the exact OpenClaw image,
persistent volume, deployment configuration, plugin sources, templates, and SHA-256 checksums. Its
location and any secret-bearing files must never be committed to Git or copied into logs.

## Validation contract

The focused broker harness must prove:

1. A correct broker secret can issue a lease; an incorrect one cannot.
2. A lease works only for its owner, agent, session, and tool.
3. Revocation and broker rotation invalidate outstanding credentials.
4. The plugin no longer reads `agent-os-tool-credentials.json`.
5. Tenant allowlists exclude filesystem mutation and command tools while preserving workspace-only
   reads, safe coordination, and granted Flolah tools.

After deployment, verify representative web chat, agent-to-agent delegation, workflow execution,
browser tool execution, WhatsApp, and scheduled-goal execution before removing the rollback window.
