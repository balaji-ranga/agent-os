# Model registry and LiteLLM operations

Flolah keeps the existing Primary, Secondary, owner BYOK, efficiency, realtime, and embedding semantics. A registry gives those consumers stable logical aliases while LiteLLM provides one internal OpenAI-compatible transport for platform-managed chat models.

## Runtime shape

- `flolah-platform-primary` and `flolah-platform-secondary` front the existing remote provider endpoints.
- `flolah-efficiency` fronts the existing local Ollama chat model.
- `flolah-local-reasoning` fronts the existing DeepSeek reasoning model in Ollama.
- Owner BYOK remains owner-scoped and bypasses the shared gateway.
- Realtime voice and embeddings remain capability-specific deployments and are not sent to chat-only models.
- vLLM is registered as a disabled deployment type. The `optional-vllm` profile is for a future appropriately sized host; it is not started by normal production deployment.

LiteLLM has no published host port. The backend and OpenClaw reach it on the private Compose network. Provider keys and the LiteLLM master key stay in `deploy/.env`; the registry stores only references such as `env:OPENAI_PRIMARY_API_KEY`.

## Safe deployment

`deploy/scripts/ensure-model-router-env.sh` creates the private gateway key without displaying it and adds non-secret defaults. `vps-deploy-latest.sh` starts LiteLLM before recreating the backend. Disable routing without removing registry data by setting `MODEL_ROUTING_ENABLED=0` and redeploying; all existing direct provider behavior remains available.

Admin users can inspect routes, deployments, capability metadata, health, and sanitized routing history at **Admin → Models & routing**. Changing a logical route affects new platform-managed requests only. Disabled or capability-incompatible deployments cannot be selected.

## Verification

Run:

```bash
cd /opt/agent-os/deploy
docker compose ps litellm
docker compose exec -T backend node scripts/test-model-routing-registry.mjs
bash scripts/vps-regression-full.sh
```

The full regression includes company setup/operate, context routing, browser contracts, goal-plan recovery, and the simple/medium/complex planning and execution stress suite. Its disposable CEO fixture is removed by a trap.
