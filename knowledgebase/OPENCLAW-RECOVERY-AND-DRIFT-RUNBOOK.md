# OpenClaw recovery and drift-control runbook

This runbook records the durable lessons from the September 2026 OpenClaw recovery. It intentionally contains no host addresses, credentials, tokens, user content, or tenant identifiers.

## Source of truth

- OpenClaw runtime configuration is generated from version-controlled deployment scripts and the runtime environment. Do not edit the generated container configuration as a hotfix.
- The authoritative writers are `deploy/scripts/configure-openclaw-docker.js`, `deploy/scripts/ensure-openclaw-gateway-config.js`, and the safe configuration helpers in `backend/src/services/openclaw-config-safe.js`.
- Tenant agents, workspaces, tool allowlists, and channel routing are synchronized by the version-controlled provisioning/sync scripts. Preserve the OpenClaw and application data volumes during image or container replacement.
- Optional development/test plugins must never be inferred from stale plugin-registry state. Only configured production plugins may be loaded.

## Invariants that must remain true

1. The gateway binds on the intended container interface and accepts only the narrowly configured trusted proxy path.
2. The reverse proxy overwrites or safely rebuilds forwarded client-attribution headers; it must not pass arbitrary client-supplied forwarding chains.
3. The gateway token remains a runtime secret. It may be rendered into the generated runtime configuration but must never enter Git, images, logs, or this runbook.
4. Every tenant agent resolves to that tenant's own workspace and credential scope. A missing tenant mapping fails closed.
5. Required workspace files (`AGENTS.md`, `AGENT-OS-OPS.md`, and `TOOLS.md`) survive rebuilds and retain the mandatory evidence contract.
6. Model-slot changes may update generated OpenClaw model configuration, but must not erase agents, workspaces, channel state, or tool grants.
7. A healthy control page alone is insufficient. The authenticated chat path, backend-to-gateway path, and public ingress must also pass.

## Safe deployment sequence

1. Record the repository revision and working-tree state. Use an existing rollback tag or immutable image checkpoint.
2. Run focused local contract tests before touching the VPS.
3. Synchronize complete source/build contexts. Do not copy individual patched files into a running container.
4. Build the replacement backend/OpenClaw image before stopping a healthy service.
5. Use the focused deployment script for a backend-only change. It retains the prior image and automatically restores it when the health deadline fails.
6. Recreate only the services whose source or configuration changed. Do not recreate data services or volumes for an application-code update.
7. Wait for container health, host-loopback ingress, public API health, and login ingress before declaring success.
8. Run the OpenClaw parity and runtime-policy checks. Then run one narrowly scoped authenticated agent call; do not use a broad regression suite unless explicitly requested.

## Drift and recovery validation

Run these version-controlled checks after OpenClaw-related deployment or suspected drift:

- `deploy/scripts/verify-openclaw-parity.js` — compares durable configuration/agent expectations.
- `deploy/scripts/test-openclaw-runtime-policy.mjs` — validates safe gateway and plugin policy.
- `deploy/scripts/vps-verify-openclaw-chat.sh` — validates the real backend-to-gateway chat path.
- `deploy/scripts/assert-vps-ingress.sh` — requires public and host-loopback health, not only in-container health.

Also verify container restart counts, recent gateway startup errors, tenant workspace paths, and mounted volume identities. Treat a regenerated empty agent list, an unexpected optional plugin, loopback-only gateway binding, broad trusted proxies, or missing forwarded-client attribution as deployment blockers.

## Failure handling

- If the new backend fails its health gate, restore the prior immutable image. Do not repair the live container interactively.
- If OpenClaw starts but chat fails, inspect the gateway startup/configuration error first; do not assume the model provider or Ollama is the cause.
- If configuration is incomplete, safe writers must refuse to overwrite the last known complete configuration.
- If tenant data appears absent, stop writes and verify volume mounts and tenant mapping before any migration or reseed.
- Remove diagnostic scripts and files copied into containers after use. Diagnostics must be read-only and must not print secrets or user message bodies into deployment logs.

## Change-review checklist

- No secret-bearing `.env`, generated runtime config, database, tenant export, or local live-LLM report is staged.
- Compose, Dockerfiles, setup scripts, and deployment documentation agree on paths, ports, volumes, health deadlines, and trusted proxies.
- Tests cover config preservation, tenant isolation, tool grants, evidence guidance, and backend-to-gateway attribution.
- The deployment scope is minimal, rollback is identified, and the prior healthy service remains available until the replacement passes.
