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
| ≥12 GB RAM **with GPU** | `deepseek-r1:8b` |
| CPU-only / 16 GB class | `llama3.2` (8B + 20k COO prompt OOM-kills 15 GB RAM) |

Never pulls `*:cloud` / `*-cloud` tags.

**Context window:** OpenClaw precheck subtracts a **20k thinking reserve** from the catalog window, so `OLLAMA_CONTEXT_WINDOW=65536`. **Ollama runtime KV** is separate: `OLLAMA_NUM_CTX=32768` (and `OLLAMA_CONTEXT_LENGTH`). 8B at 65k allocated **9.2 GiB KV** on this VPS and was SIGKILL’d → OpenClaw **408 upstream provider timeout**. CPU hosts use `llama3.2`. OpenClaw Ollama provider uses native `/api/chat` (not `/v1`) with `timeoutSeconds` from `OPENCLAW_OLLAMA_CHAT_TIMEOUT_MS` (600s on CPU hosts), `params.thinking=false`, `keep_alive=30m`.

**Dashboard UX on local Ollama:** **New chat** titles the archive from the first user message (no extra LLM call — that used to hang **Archiving…** forever). Background specialty retries are skipped, and OpenClaw `maxConcurrent` is **1**, so Kanban floods cannot starve COO **hi**. Greetings skip tool-bootstrap instructions. First **hi** can still take a few minutes of CPU prefill; it should complete, not 408.

## Enable on a host

```bash
APPLY_LOCAL_OLLAMA=1 bash deploy/scripts/ensure-local-openclaw-ollama.sh
# then recreate so OpenClaw/backend pick up env:
cd deploy && docker compose up -d --force-recreate openclaw backend
```

On later deploys, `PLATFORM_USE_LOCAL_OLLAMA=1` in `deploy/.env` keeps the local primary (it wins over Admin “use secondary”). `vps-deploy-latest.sh` and `up.sh` call the ensure script.

GPU hosts: the script appends `docker-compose.ollama-gpu.yml` when `nvidia-smi` reports VRAM.

## What it rewrites

- `OPENAI_BASE_URL` / `OPENAI_PRIMARY_*` → `http://ollama:11434/v1`
- `OPENCLAW_MODEL_PRIMARY` → `ollama/<selected-tag>`
- `OLLAMA_MODEL` / context / chat timeout
- Previous DeepSeek cloud key saved as `DEEPSEEK_CLOUD_*` (not used as primary)

Admin **Use secondary** still works if `OPENAI_SECONDARY_*` is set (paid). Leave it unused to stay free.

## Revert to cloud DeepSeek

Restore `OPENAI_*` / `OPENCLAW_MODEL_PRIMARY` from `DEEPSEEK_CLOUD_*`, set `PLATFORM_USE_LOCAL_OLLAMA=0`, recreate `openclaw` + `backend`.
