# Browser Session — Desktop Local Mode (single release)

**Status:** Implement as **one shippable product**. Do not deliver half of this list.  
**Related:** [CLIENT-BROWSER-SESSION.md](./CLIENT-BROWSER-SESSION.md) (today's server relay + lease), [IBKR-LOCAL-BRIDGE.md](./IBKR-LOCAL-BRIDGE.md) + [platform-help/17-desktop-windows-download.md](./platform-help/17-desktop-windows-download.md) (packaging templates).

## 1. Problem and goal

| Today | Goal of this release |
|-------|----------------------|
| OpenClaw Browser Relay WSS + secret is **one per gateway** | Each CEO's real browser control runs on **their Windows machine** |
| Exclusive chrome lease (one Client Chrome holder) | **Concurrent** Client Chrome: many CEOs, each with their own local worker online |
| `browse_*` / recipe replay always hit VPS `browser-cdp` | When local worker **online** for owner → all browser I/O goes to that worker |
| Desktop workflow package: no browser | Workflow desktop can call **loopback browser worker** (same as W2 → IBKR bridge) |

Managed Playwright on OpenClaw (`profile=openclaw`) remains for CEOs **without** a live worker.

## 2. Product definition (what "done" means)

Ship **Local Browser Worker** (IBKR-bridge twin), fully integrated:

1. CEO downloads a **standalone Windows zip** (prerequisites bundled; no `npm install` for the happy path).
2. Unzip → `Start-BrowserWorker.ps1` (optional Task Scheduler at logon) → worker stays running.
3. Worker registers with Flolah as **owner-scoped**; heartbeats while alive.
4. Browser Session UI shows **worker online / offline** (not shared WSS lease as primary multi-user story).
5. For that CEO, **`browse_task_*` / `browse_snapshot` / `browse_act` / `browse_recipe_*` / recipe_replay / autonomous loop** execute on the **local worker** when online.
6. Workflow **Download for Windows** can drive browser via **loopback API** to that worker (documented vars + optional combo zip).
7. Full package includes: portable Node, worker app, Playwright, Chromium, extension folder for signed-in Chrome, env with minted token, scripts, README.
8. Auth, revoke, owner filtering, BYOK for autonomous LLM (still server-side plan), no spoofed `ceo_user_id`.
9. Deploy: package cache on VPS works; local + VPS smoke pass.
10. Docs: this file + platform-help update; lease documentation updated so multi-user path is worker-first.

**Not done if:** only zip exists without dispatch; only dispatch without package; agents still on shared WSS for Client Chrome when worker is online.

## 3. Mental model

```
CEO Windows PC                          Flolah (VPS)
-----------------                       -----------------------------
Local Browser Worker (long-lived)       browser-worker tokens / registry
  Playwright Chromium  and/or             register + heartbeat
  extension-attached Chrome               job pull channel
  Loopback HTTP :3xxx                     resolveBrowserProfile:
  Outbound HTTPS to Flolah                   desktop_worker if online
Desktop workflow (optional, one-shot)        else openclaw (managed)
  Run-Workflow.ps1 → 127.0.0.1:3xxx     browse_* / tasks
  dsk_ for Flolah remote nodes          autonomous LLM still on server
```

**Long-lived worker is mandatory** for multi-user **agent** Client Chrome. One-shot `Run-Workflow.ps1` alone is only for workflow graph runs while the worker is already up.

Chat agent still only calls `browse_*`. Agent OS still runs the autonomous observe→decide→act loop. The **body** (open/snapshot/act) is worker instead of OpenClaw `chrome` when worker is online.

## 4. Architecture (must all land together)

### 4.1 Local Browser Worker (new tree)

**Path:** `backend/local-browser-worker/` (mirror `local-ibkr-bridge/`).

| Piece | Responsibility |
|-------|----------------|
| Loopback HTTP API | Bound `127.0.0.1` only; bearer in `.env` |
| Drivers | (A) Playwright managed Chromium; (B) extension / attach real Chrome |
| Action surface | Align with tasks: `status`, `open`, `snapshot`, `act` (click/type/press/scroll), optional `evaluate` |
| Cloud channel | **Outbound** only: WS or long-poll to Flolah (no inbound port) |
| Job runner | Pull job → run open/snapshot/act → POST result; timeout + cancel |
| Health | Local `GET /health`; remote heartbeat includes driver mode + ready |

Do **not** ship full OpenClaw gateway in the zip.

### 4.2 Package builder

**Path:** `backend/src/services/local-browser-worker-package.js`  
**Pattern:** `local-ibkr-bridge-package.js` + `desktop-windows-node-runtime.js` + Playwright/Chromium **server-side cache**.

Zip (full pack default):

| Entry | Notes |
|-------|--------|
| `runtime/node.exe` | Portable Node 18 |
| `worker/` + prebundled `node_modules` | No user `npm install` |
| Chromium for Playwright | Cached on server, embedded in zip |
| `chrome-extension/` | Load unpacked folder |
| `.env` | Minted `BROWSER_WORKER_TOKEN`, `AGENT_OS_BASE_URL`, loopback port |
| `scripts/Start-BrowserWorker.ps1` | Prefer bundled Node |
| `scripts/Register-TaskScheduler.ps1` | Logon start |
| `README-BROWSER-WORKER.txt` | Install steps |

Lite zip (optional): no Node/Chromium — ops only.

### 4.3 Auth and data

| Store | Purpose |
|-------|---------|
| `browser_worker_tokens` | hash, prefix, owner, revoked_at |
| `browser_worker_nodes` | online, last_heartbeat, version, driver_mode |
| jobs | action, args, status, result, timeout |

Rules: download with CEO session; token → owner_user_id; never trust body `ceo_user_id` for auth; loopback-only on PC.

### 4.4 Register / job protocol

Path prefix e.g. `/api/browser-worker/v1/` (worker bearer, no CEO cookie).

| Call | Role |
|------|------|
| `POST …/register` | Bind token; version/driver |
| `POST …/heartbeat` | Keep online; offline after ~90s silence |
| `GET …/jobs?wait=` or WS | Pull next job |
| `POST …/jobs/:id/result` | Result/error |
| Internal enqueue | From `browser-tasks` |

```
browserInvoke(ceo, action, args)
  if worker online for ceo → enqueue + wait result
  else → OpenClaw browser-cdp + profile openclaw
```

When worker online: **do not** use OpenClaw profile `chrome` for that CEO.

### 4.5 Profile resolution

| Condition | Target |
|-----------|--------|
| Worker online | `desktop_worker` |
| Worker offline | `openclaw` managed |
| Shared Client Chrome lease | Optional emergency single-tenant only; multi-user default is worker |

### 4.6 Task modes

Orchestration stays in `browser-tasks.js` on server. `open`/`snapshot`/`act` run on local worker when online: autonomous, recipe_replay, single tools, recorder.

Recipe **storage stays cloud** (per CEO).

### 4.7 Desktop workflows

- Local `api` nodes → `http://127.0.0.1:<port>/…` with worker bearer (like IBKR bridge).
- Optional desktop orchestrator `browser` node type.
- Desktop modal: "requires Local Browser Worker running"; link / optional combo zip.

### 4.8 Frontend

Browser Session: download zip, worker status, token revoke, setup, deprioritize shared WSS for multi-tenant. Workflow Desktop modal: worker prerequisite. Optional Connectors entry.

### 4.9 Security

Authenticated download/status; agent tool grants; BYOK `chatCompletions` for decide; redact tokens; no gateway secret in zip; URL policy server-side before open.

## 5. Code / file map

| Area | Paths |
|------|--------|
| Worker | `backend/local-browser-worker/**` |
| Package | `local-browser-worker-package.js`, Chromium cache |
| Auth/dispatch | `browser-worker-auth.js`, `browser-worker-dispatch.js` |
| Routes | `browser-worker.js`, extend `browser-session.js` |
| Schema | tokens, nodes, jobs |
| Profile/tasks | `client-browser-session.js`, `browser-tasks.js`, social path if shared invoke |
| FE | `BrowserSession.jsx`, `api.js`, DesktopPackageModal |
| Deploy | sync worker tree + data-dir cache |
| Docs/tests | this file, CLIENT-BROWSER-SESSION, help 22/17; zip/dispatch/routing smoke |

## 6. Loopback API (minimum)

| Method | Path |
|--------|------|
| GET | `/health` |
| POST | `/v1/open` `{ url }` |
| POST | `/v1/snapshot` `{ limit? }` |
| POST | `/v1/act` (same shapes as OpenClaw acts) |
| POST | `/v1/status` |

Cloud job payload mirrors these.

## 7. Config

| Env | Role |
|-----|------|
| Public base URL | written into package |
| `BROWSER_WORKER_TOKEN` | worker auth |
| `AGENT_OS_BASE_URL` | register/jobs |
| `LOOPBACK_PORT` | e.g. 3020 |
| `BROWSER_WORKER_OFFLINE_MS` / job timeout | server |
| Node + Chromium caches | `AGENT_OS_DATA_DIR` |

## 8. Release checklist (all required)

- [ ] Worker + Playwright Chromium + loopback API
- [ ] Extension attach for signed-in Chrome
- [ ] Full zip (Node + deps + Chromium + extension + scripts); no happy-path npm install
- [ ] Download API + token mint/revoke UI
- [ ] Register + heartbeat + offline detection
- [ ] Pull/result jobs (outbound from PC)
- [ ] `browserInvoke` → worker when online
- [ ] Autonomous + recipe_replay + tools on worker path
- [ ] `browse_session_status` reports worker
- [ ] Managed OpenClaw fallback when offline
- [ ] Multi-CEO isolation
- [ ] Desktop workflow loopback docs/vars/combo
- [ ] URL policy + grants + owner scope
- [ ] Redacted logs
- [ ] Tests + VPS cache; local and VPS smoke
- [ ] Docs updated

## 9. Out of scope

- Shared-gateway multi WSS / OpenClaw fork
- Linux/mac packages (Windows first)
- Electron/MSI (zip + PS1)
- Removing managed Playwright
- Cookies on VPS
- Chat agent long-lived DOM context

## 10. Acceptance scenarios

1. CEO A and B both online — each recipe/task only drives own PC.
2. Autonomous `browse_task_start` with worker + BYOK decide loop.
3. Recipe record/replay on worker path.
4. Worker stopped → offline → managed fallback or clear fail; never B's worker.
5. Desktop workflow loopback open while remote nodes use `dsk_`.
6. Revoke token → re-download new token.
7. Fresh PC full zip only (no system Node) starts successfully.

## 11. Risks and fixed decisions

| Risk | Decision |
|------|----------|
| Zip ~150–250MB+ | Accept full pack; server Chromium cache |
| NAT | Worker outbound pull only |
| Shared WSS multi-tenant | Rejected; local worker is the path |
| Recipe without worker | Unsupported |
| Social deterministic path | Server orchestrator; CDP on worker |

## 12. Engineering sequence (same release; not product phases)

1. Schema + auth + package skeleton  
2. Worker Playwright + loopback  
3. Register/heartbeat + jobs + `browserInvoke` adapter  
4. All browse/task modes + status UI  
5. Extension attach + full Chromium bundle  
6. Desktop workflow docs/vars/combo  
7. Tests, VPS cache, docs, lease text  

**Do not call any partial stack a product release.**

---

**Bottom line:** One product = long-lived local browser worker + full prerequisites zip + owner-bound cloud dispatch + browse/task routing + UI + workflow loopback. Implement and ship as a whole.