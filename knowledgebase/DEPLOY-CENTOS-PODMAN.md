# Deploy Agent OS on CentOS with Podman

Guide for running the Compose stack on **CentOS Stream / RHEL 8+** using **Podman** (recommended on CentOS) or Docker CE.

## Prerequisites

| Requirement | Version / notes |
|-------------|-----------------|
| OS | CentOS Stream 9, RHEL 8+, Rocky, AlmaLinux |
| Podman | 4.x+ (`podman --version`) |
| Podman Compose | `podman-compose` or Docker Compose with Podman socket |
| Node (bare-metal bootstrap only) | 22.12+ if not using containers |
| RAM | 8 GB+ recommended (OpenClaw + Chromium browser jobs) |
| Disk | 20 GB+ (images, Ollama models, browser profile, SQLite) |

```bash
# CentOS Stream 9 example
sudo dnf install -y podman podman-compose git curl openssl

# Optional: Docker Compose plugin talking to Podman
sudo dnf install -y docker-compose-plugin
export DOCKER_HOST=unix:///run/user/$(id -u)/podman/podman.sock
```

## Firewall

Only expose the reverse proxy — **not** OpenClaw (18789) or backend (3001).

```bash
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=http   # or remove after TLS redirect only
sudo firewall-cmd --reload
```

## SELinux and volumes

Compose files use `:Z` on volume mounts so Podman relabels content for container access. If you see permission denied on `/var/lib/openclaw` or `/data/agent-os`:

```bash
# One-time (if running rootful podman with custom host paths)
sudo chcon -Rt container_file_t /path/to/volume
```

Rootless Podman: prefer named volumes (`agent_os_data`, `openclaw_home`) as defined in `deploy/docker-compose.yml` — SELinux handling is automatic with `:Z`.

## Deploy steps

```bash
git clone <your-repo> /opt/agent-os
cd /opt/agent-os/agent-os/deploy

cp .env.example .env
vi .env   # AGENT_OS_PUBLIC_URL, tokens, OPENAI_API_KEY

# TLS — use Let's Encrypt certs or internal CA
./scripts/generate-dev-certs.sh your.domain.com   # staging only
# Production: copy fullchain.pem + privkey.pem to nginx/certs/

chmod +x scripts/*.sh ../scripts/setup-openclaw-from-scratch.sh

USE_PODMAN=1 ./scripts/up.sh
```

Verify:

```bash
podman compose ps
curl -k https://your.domain.com/health
curl -k https://your.domain.com/api/health
```

## Podman-specific runtime notes

### OpenClaw + Chromium (Playwright)

The `openclaw` service runs headless Chromium for the Job Applicant pipeline and `browser` tool.

- **`shm_size: 2gb`** — required; default `/dev/shm` is too small for Chromium.
- **`seccomp=unconfined`** and **`SYS_ADMIN`** — often needed for Playwright sandbox on RHEL-family kernels. If browser fails, check `podman logs openclaw`.
- Browsers are baked into the image at `/opt/playwright` via `PLAYWRIGHT_BROWSERS_PATH`.

### Shared OpenClaw home

Backend and OpenClaw **must share** the `openclaw_home` volume:

- Workspace MD files (`SOUL.md`, etc.)
- Browser cookies (`browser/openclaw/user-data`)
- Media (`media/`, including generated images)
- `openclaw.json`, sessions, extensions

Never run backend and openclaw with separate `.openclaw` directories.

### Gateway security

- Keep `openclaw` on the internal Compose network only (`expose: 18789`, no `ports:`).
- Set a strong `OPENCLAW_GATEWAY_TOKEN` in `.env`; init writes it to `gateway.auth.token`.
- See **GATEWAY-PAIRING-1008.md** if chat fails with pairing errors.

## Bootstrap: `setup-openclaw-from-scratch.sh`

| Where | Command |
|-------|---------|
| Init container | `docker compose --profile init run --rm init` |
| Bare metal (no containers) | `./scripts/setup-openclaw-from-scratch.sh` |
| Re-seed after agent/skill changes | Same init command, then restart gateway |

Flags:

| Flag | Purpose |
|------|---------|
| `--docker` | Use `/var/lib/openclaw` and `/data/agent-os` paths |
| `--skip-db-seed` | Skip SQLite seeds if DB already populated |
| `--skip-openclaw-setup` | Skip `openclaw setup` CLI |
| `--install-browser` | Enable browser in config + ensure Chromium |

## Optional services on CentOS

### Ollama (`optional-ollama` profile)

```bash
podman compose --profile optional-ollama up -d
podman compose exec ollama ollama pull llama3.2
```

Set in `.env`: `OLLAMA_BASE_URL=http://ollama:11434` (default in compose). OpenClaw uses Ollama as model fallback when primary LLM fails.

### MCP test server (`optional-mcp` profile)

For workflow SSE/hook testing only — not required in production unless you host MCP integrations here.

### OpenConnector mock (`optional-openconnector` profile)

Registers SaaS-action MCP tools for workflows (list/search/execute). For staging:

```bash
# In deploy/.env:
# OPENCONNECTOR_MCP_URL=http://openconnector-mcp-mock:3105/mcp

podman compose --profile optional-openconnector up -d
podman compose exec backend node scripts/seed-openconnector-mcp.js
```

Production: point `OPENCONNECTOR_MCP_URL` at a real OpenConnector `/mcp` endpoint (and set `OPENCONNECTOR_MCP_BEARER` if required). See **OPENCONNECTOR-WEBHOOKS.md**.

### Job Applicant browser login (`optional-browser-login`)

LinkedIn/JobStreet login uses a **persistent Playwright profile** under `openclaw_home`. On a headless CentOS server you have three options:

1. **Copy profile from dev machine (simplest)**  
   After logging in locally, copy `~/.openclaw/browser/openclaw/` into the `openclaw_home` volume.

2. **Enable VNC on OpenClaw**  
   Set `ENABLE_VNC=1` in `.env`, start stack, connect a VNC client to the openclaw container on port 5900 (internal). Use Job Profiles → Connect portals in the UI.

3. **noVNC desktop profile**  
   ```bash
   ENABLE_VNC=1 podman compose --profile optional-browser-login up -d
   ```  
   Open `http://server:6080`, use the shared volume to run login scripts or manual browser steps documented in **JOB-APPLICANT-WORKFLOW.md**.

After login, click **Save & connect** in Job Profiles so cookies persist in the volume.

## Production checklist

- [ ] `AGENT_OS_PUBLIC_URL` set to real HTTPS URL
- [ ] Real TLS certs in `deploy/nginx/certs/`
- [ ] Strong `OPENCLAW_GATEWAY_TOKEN`, `TOOLS_API_KEY`, `AGENT_OS_INTERNAL_TOKEN`, `AGENT_OS_ADMIN_PASSWORD`
- [ ] `OPENAI_API_KEY` (and optional OpenRouter/Replicate keys)
- [ ] Firewall: only 443 (and 80 redirect) public
- [ ] Back up volumes `agent_os_data` + `openclaw_home` (+ `workflow_fs` if using filesystem nodes)
- [ ] `OPENCLAW_DISCOVERY_TIMEOUT_MS=900000` for long browser jobs
- [ ] Monitor memory on `openclaw` container (Chromium)
- [ ] Optional: `WORKFLOW_SMTP_*` for email workflows / MFA OTP
- [ ] Optional: `EMAIL_INBOUND_WEBHOOK_SECRET` + provider webhook → `/api/integrations/email-inbound/:id`
- [ ] Optional: `OPENCONNECTOR_MCP_URL` (+ `optional-openconnector` mock or real OpenConnector)

## Upgrades

```bash
cd /opt/agent-os/agent-os
git pull
cd deploy
# ensure new secrets exist (AGENT_OS_INTERNAL_TOKEN, etc.)
node ../scripts/ensure-deploy-secrets.js --env-file .env
podman compose build
podman compose --profile init run --rm init
podman compose up -d
# If using OpenConnector:
# podman compose exec backend node scripts/seed-openconnector-mcp.js
```

After upgrades that add routes (master-data, feedback, email-inbound, openconnector), a **backend + frontend rebuild** is enough — nginx already proxies all `/api/*`.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Chat "pairing required" | `OPENCLAW_GATEWAY_TOKEN` matches `openclaw.json`; restart openclaw |
| Content tools fail | Plugin `baseUrl` → `http://backend:3001`; backend healthy |
| Browser tool crashes | `podman logs openclaw`, increase shm, verify Playwright deps |
| SQLite permission | Volume `:Z`, check `AGENT_OS_DATA_DIR` |
| Workflow hooks 404 | `AGENT_OS_PUBLIC_URL` wrong; nginx `/api` proxy |
| SELinux denials | `ausearch -m avc -ts recent`; use `:Z` volumes |

## systemd (optional)

To start the stack on boot, create a systemd unit that runs `podman compose up -d` from `/opt/agent-os/agent-os/deploy`, or use **Podman Quadlet** (`*.container` files) — see Podman docs for generating units from Compose.

## Related docs

- **deploy/README.md** — Compose reference
- **OPENCONNECTOR-WEBHOOKS.md** — OpenConnector MCP, email inbound, filesystem workflows
- **GATEWAY-PAIRING-1008.md** — gateway auth
- **JOB-APPLICANT-WORKFLOW.md** — browser pipeline
- **TESTING.md** — smoke tests
