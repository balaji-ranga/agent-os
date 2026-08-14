# Local OpenClaw + free Ollama (no cloud)

Point **Agent OS platform LLM** and the **local OpenClaw gateway** (Docker service `openclaw` on the VPS) at **self-hosted Ollama**. This does **not** use Ollama Cloud or paid DeepSeek/OpenAI for the platform primary.

## Intended model (128B)

| Tag | Parameters | Disk (Q4) | Hardware |
|-----|------------|-----------|----------|
| `mistral-medium-3.5` | 128B dense | ~80 GB | ~80 GB GPU VRAM **or** ~96 GB RAM |

A typical 16 GB CPU VPS **cannot** load 128B. `ensure-local-openclaw-ollama.sh` auto-selects:

| Host | Selected tag |
|------|----------------|
| ≥78 GB GPU or ≥96 GB RAM | `mistral-medium-3.5` (128B) |
| ≥22 GB GPU or ≥32 GB RAM | `gpt-oss:20b` |
| ≥12 GB RAM | `deepseek-r1:8b` (already pulled on the current VPS) |
| smaller | `llama3.2` |

Never pulls `*:cloud` / `*-cloud` tags.

**Context window:** local OpenClaw primary uses `OLLAMA_CONTEXT_WINDOW=32768` (and Ollama `OLLAMA_CONTEXT_LENGTH`). An 8k window rejects even "hi" because COO bootstrap + tool schemas exceed 8k (`Context overflow: prompt too large for the model`). Do not lower this below 32k while Ollama is the platform primary.

## Enable on a host

```bash
APPLY_LOCAL_OLLAMA=1 bash deploy/scripts/ensure-local-openclaw-ollama.sh
# then recreate so OpenClaw/backend pick up env:
cd deploy && docker compose up -d --force-recreate openclaw backend
```

On later deploys, `PLATFORM_USE_LOCAL_OLLAMA=1` in `deploy/.env` keeps the local primary. `vps-deploy-latest.sh` and `up.sh` call the ensure script.

GPU hosts: the script appends `docker-compose.ollama-gpu.yml` when `nvidia-smi` reports VRAM.

## What it rewrites

- `OPENAI_BASE_URL` / `OPENAI_PRIMARY_*` → `http://ollama:11434/v1`
- `OPENCLAW_MODEL_PRIMARY` → `ollama/<selected-tag>`
- `OLLAMA_MODEL` / context / chat timeout
- Previous DeepSeek cloud key saved as `DEEPSEEK_CLOUD_*` (not used as primary)

Admin **Use secondary** still works if `OPENAI_SECONDARY_*` is set (paid). Leave it unused to stay free.

## Revert to cloud DeepSeek

Restore `OPENAI_*` / `OPENCLAW_MODEL_PRIMARY` from `DEEPSEEK_CLOUD_*`, set `PLATFORM_USE_LOCAL_OLLAMA=0`, recreate `openclaw` + `backend`.
