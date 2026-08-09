# SQLite to PostgreSQL (Flolah) - End-to-End Migration Plan

**Status:** Approved plan (implementation not started)  
**Scope:** Full cutover of **all Flolah Agent OS application data** from SQLite to PostgreSQL  
**Not a partial migration:** when complete, the backend **must not** open `agent-os.db` or `tenants/*/ceo.db` for any runtime feature path.

---

## 1. Purpose and non-goals

### Why

Flolah currently stores almost all application state in SQLite (`better-sqlite3`). That is viable for a single Node backend and a Docker volume, but it limits multi-instance backends, concurrent write scale, and shared ops with the existing Twenty CRM Postgres host.

### Goal (definition of done)

1. **One system of record** for Flolah: PostgreSQL database `flolah` on the shared `twenty-db` instance.
2. **Zero runtime dependency** on platform/tenant SQLite files for Agent OS features.
3. All existing product behavior preserved (auth, chat history, agents/workflows/kanban, IBKR ledgers/snapshots, master-data tables, MCP OAuth bindings, company-CRM maps, budgets, etc.).
4. Local and VPS deploy both run green on Postgres only.
5. Documented backup/restore and rollback for the cutover window.

### Explicit non-goals (still complete Flolah)

| System | Engine after migration | Reason |
|--------|------------------------|--------|
| **Twenty CRM business data** | Postgres DB `twenty` (`core`, `workspace_*`) | Already on Postgres; Flolah continues REST/GraphQL + SSO SQL only |
| **OpenSearch RAG indices** | OpenSearch | Primary RAG store; not SQLite |
| **OpenClaw agent runtime SQLite** (`openclaw-agent.sqlite`) | Unchanged | Third-party agent store under `OPENCLAW_DIR`; not Flolah app schema |
| **ERPNext MariaDB** | Unchanged | Separate stack |
| **Workspace files / media on disk** | Volumes / filesystem | Not relational SORs; ownership rows move to Postgres |

End-to-end means every Agent OS SQLite database (`agent-os.db` + all `ceo.db`), not the broader platform non-Flolah stores.

---

## 2. Current as-built (SQLite)

### Storage layout

```text
AGENT_OS_DATA_DIR  (deploy: /data/agent-os)
├── agent-os.db                 # platform + shared-CEO data (WAL)
└── tenants/{ceoId}/
      └── ceo.db                # optional per-CEO when ceo_db_mode=tenant
```

| Concern | Code |
|---------|------|
| Platform open / DDL | `backend/src/db/schema.js` - `initDb()`, `getDb()`, `getDbPath()` |
| Tenant open / DDL | `backend/src/db/ceo-db.js` - `getCeoDb()`, `initCeoDb()` |
| Router | `backend/src/db/request-db.js` - `getDbForCeo()` |
| Mode | `backend/src/db/ceo-db-config.js` |
| Startup | `backend/src/index.js` calls `initDb()` |

There is **no ORM** and **no versioned migration runner**. Schema evolves via `CREATE IF NOT EXISTS` + swallow-fail `ALTER` + service-level `ensure*` helpers.

### What is on SQLite (not metadata only)

| Domain | Examples (tables / services) |
|--------|------------------------------|
| **Chat history** | `chat_turns`, `chat_sessions`, `chat_session_meta`, workflow chat turns |
| **Agents and work** | `agents`, kanban, workflows/A2A, standups, activities, notifications |
| **Auth and platform** | `platform_users`, sessions, MFA, API keys, budgets, `token_usage` |
| **IBKR functional** | budgets, reservations, order events, fills, **position snapshots**, realized PnL, cash events, equity marks, day plans, account snapshot cache |
| **Market data** | `market_data_cache` |
| **Master data** | structured tables/rows; document meta remaining beside OpenSearch |
| **Integrations** | MCP servers/OAuth, company business profiles / Twenty workspace IDs, browser session and recipes |
| **Logs** | content tool logs, MCP call logs, agent feedback |

### SQLite dialect in heavy use

- `datetime('now')` and relative datetime
- `INTEGER PRIMARY KEY AUTOINCREMENT`
- `INSERT OR IGNORE` / `INSERT OR REPLACE` / `ON CONFLICT`
- `last_insert_rowid()`
- `PRAGMA`, `sqlite_master`, `pragma_table_info`
- Sync API: `db.prepare().get/all/run`, `db.transaction()`, `db.exec()`
- WAL journal mode; single writer process in production

### Adjacent stores (already not Flolah SQLite SORs)

- **OpenSearch:** document RAG; startup can migrate docs from SQLite to OpenSearch.
- **`TWENTY_DATABASE_URL`:** SSO / workspace SQL into Twenty only (`twenty-sso.js`, `twenty-workspace.js`).
- **OpenClaw `openclaw-agent.sqlite`:** BYOK/auth profiles for OpenClaw agents only.

---

## 3. Target architecture

### Host sharing rule

**Share the Postgres server with Twenty CRM; never share Twenty's database or schemas.**

```text
Container: twenty-db  (postgres:16-alpine, volume twenty_db_data)

├── Database: twenty                    # OWNED BY Twenty CRM ONLY
│   ├── schema: core
│   └── schema: workspace_*
│
└── Database: flolah                    # OWNED BY Agent OS / Flolah ONLY
    ├── schema: platform                # all application tables (unified)
    ├── schema: migration               # migration bookkeeping only
    └── Roles
        ├── twenty                      # existing; access to DB twenty only
        └── flolah_app                  # NEW; CONNECT flolah + DML on platform
```

### Why a separate database (not tables inside `twenty`)

1. Twenty upgrades/restores must not touch Flolah.
2. Least privilege: app role never needs `core.user` / workspace data (SSO already uses a separate URL).
3. Independent backup/restore and retention.
4. Satisfies different schemas for Flolah while sharing the compose service and disk.

### Tenancy decision (mandatory for E2E)

**Collapse** dual-file tenancy into a **single schema `platform`** with existing `owner_user_id` columns and auth/entitlement filters.

| Before | After |
|--------|--------|
| `agent-os.db` + optional `tenants/*/ceo.db` | One Postgres schema `platform` |
| `getDbForCeo` to file | `getDbForCeo` to same pool / `search_path=platform` |
| `ceo_db_mode=tenant` creates files | Column retained for audit/history only; **no new tenant DBs** |

Rationale: most platform features already use shared `agent-os.db` + owner columns; tenant files hold a subset. Dual schema-per-CEO multiplies migrations and import complexity without product-level isolation guarantees across all tables. E2E completeness prefers **one SOR + owner scope**.

### Connection configuration

| Env | Purpose |
|-----|---------|
| `FLOLAH_DATABASE_URL` | `postgres://flolah_app:<pass>@twenty-db:5432/flolah` |
| `FLOLAH_DB_SCHEMA` | Default `platform` (`search_path`) |
| `FLOLAH_DB_POOL_MAX` | Pool size (default e.g. 10-20) |
| `TWENTY_DATABASE_URL` | Unchanged - SSO / workspace only |
| `AGENT_OS_DATA_DIR` | Retained for non-SQL files if needed; **not** for app SQLite after cutover |

Deploy: backend container resolves `twenty-db` on the compose network; Postgres must be healthy before backend serves traffic.

---

## 4. End-to-end delivery (single migration program)

This is **one complete program**, not staged partial product releases. Work is sequenced; each package is finished before cutover. **There is no half-on-SQLite half-on-Postgres product state.**

### Package A - Infrastructure

**Deliverables**

1. Init SQL (or entrypoint script on `twenty-db`) that is idempotent:
   - `CREATE DATABASE flolah` (if missing)
   - `CREATE ROLE flolah_app LOGIN PASSWORD ...`
   - Grants: connect to `flolah`, `USAGE`/`CREATE` on schema `platform` (initially) or grant via migrate runner
2. Compose / VPS scripts (`ensure-business-core-env.sh`, `docker-compose.business-core.yml`, backend env in `docker-compose.yml`):
   - Wire `FLOLAH_DATABASE_URL`
   - Backend `depends_on` / health wait for Postgres
3. Make Postgres **required** for backend in local and VPS profiles used for Agent OS (no silent SQLite fallback in production builds post-cutover).
4. Backup docs + scripts: `pg_dump`/`pg_restore` for database `flolah` (and keep volume freeze procedure for pre-cut SQLite).

**Exit criteria:** empty `flolah` DB reachable from backend container; role cannot write DB `twenty`.

### Package B - Async data access layer

**Deliverables**

1. Replace better-sqlite3 process model with **`pg` Pool** for Flolah (already in package.json for Twenty).
2. Canonical module e.g. `backend/src/db/client.js`:
   - `initDb()` / `getPool()` async-aware startup
   - `query(sql, params)`, `queryOne`, `execute`, `withTransaction(fn)`
   - `search_path` set to `platform` on acquire
3. Remove public sync SQLite-style handles from the app surface. Call sites become `async` end-to-end for DB.
4. Transaction mapping: better-sqlite3 `db.transaction()` to `BEGIN` / `COMMIT` / `ROLLBACK` with a single client checked out from the pool.

**Exit criteria:** backend boots against empty Postgres and fails clearly if URL missing; no production path calls `new Database(path)` for Flolah.

### Package C - Schema + versioned migrations

**Deliverables**

1. Translate **every** table currently created by:
   - `schema.js`
   - `ceo-db.js`
   - service `ensure*` helpers (IBKR, market cache, MFA, chat meta, blueprints, browser, master-data, etc.)
2. Introduce **versioned migrations** in e.g. `backend/src/db/migrations/`:
   - Table `migration.schema_migrations (id, applied_at)`
   - Ordered SQL or JS migration modules applied on boot via `initDb()`
3. Type norms (apply consistently):

   | SQLite | Postgres |
   |--------|----------|
   | `INTEGER PRIMARY KEY AUTOINCREMENT` | `GENERATED BY DEFAULT AS IDENTITY` (or `BIGSERIAL`) |
   | `TEXT` timestamps from `datetime('now')` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |
   | `INTEGER` 0/1 flags | Prefer `BOOLEAN` when converting call sites; or keep `SMALLINT` for minimal delta - **pick one and use everywhere** |
   | JSON-as-TEXT | `JSONB` for structured blobs that are filtered; `TEXT` OK for opaque |
   | Partial unique indexes | Same in Postgres |
   | FKs | Enabled; cascade policies matching product delete flows |

4. Replace ad-hoc `PRAGMA table_info` rebuild migrations with a single clean-target schema migration (import maps columns explicitly).

**Exit criteria:** cold-start on empty Postgres creates full schema; second start is no-op; schema matches inventory checklist (Appendix A).

### Package D - Dialect conversion of all writers/readers

**Deliverables**

Global conversion of SQL and helpers:

| Pattern | Replacement |
|---------|-------------|
| `datetime('now')` | `NOW()` / bind timestamps from JS |
| `INSERT OR IGNORE` | `INSERT ... ON CONFLICT DO NOTHING` |
| `INSERT OR REPLACE` / upsert | `ON CONFLICT (...) DO UPDATE` |
| `last_insert_rowid()` | `RETURNING id` |
| `sqlite_master` existence | migrations only / `to_regclass` |
| Boolean integers | Consistent Postgres types |
| Parameter placeholders | Prefer `$1,$2` with `pg` (or a thin binder) |

Convert **all** of:

- `backend/src/services/**`
- `backend/src/routes/**`
- `backend/src/cron/**`
- `backend/src/db/seed-*.js`
- backend scripts that are operator-facing post-cutover
- deploy password-reset / verify scripts that read `agent-os.db`

**Exit criteria:** ripgrep for Flolah runtime code finds **zero** of: `better-sqlite3`, `datetime('now')`, `last_insert_rowid`, `INSERT OR IGNORE`, `sqlite_master`, `PRAGMA`, `getDbPath` for app data (allowlist only migration tooling and tests that opt-in).

### Package E - Data migration (full dump import)

**Deliverables**

1. Offline migrator CLI, e.g. `backend/scripts/migrate-sqlite-to-postgres.mjs`:
   - Inputs: `AGENT_OS_DATA_DIR` (source SQLite files) + `FLOLAH_DATABASE_URL`
   - Reads `agent-os.db` **and every** `tenants/*/ceo.db`
   - Merges tenant rows into `platform` with deterministic conflict rules (`owner_user_id` + natural keys; report duplicates)
   - Bulk insert with frozen ordering for FK-safe tables
   - Batched commits; primary path is one clean import
2. **Parity verification** report (must pass):
   - Per-table row counts (platform + sum of tenants after merge rules)
   - Critical checksums: user ids, agent ids, active sessions count, open kanban tasks, workflow runs in non-terminal state, IBKR reservation/open order events, `company_business_profiles.twenty_workspace_id`, MCP OAuth tokens presence (hashed/redacted in logs)
3. Re-run only after truncate of target (or migrate into empty DB only) - document as **replace**, not continuous dual-write.

**Exit criteria:** import tool exit 0 with parity report signed off; failed parity aborts cutover.

### Package F - Tests and operator tooling

**Deliverables**

1. Test harness uses ephemeral Postgres (compose service or testcontainer) instead of temp SQLite dirs for all DB-touching suite entries.
2. Update smoke/regression entrypoints and `deploy/scripts/vps-verify-platform.sh` to assert Postgres connectivity and key tables.
3. Convert reset/heal ops scripts from file-open SQLite to SQL against `flolah`.
4. Remove or quarantine one-off probes that teach wrong SOR; only supported tools remain documented.

**Exit criteria:** CI/local smoke green on Postgres; VPS verify green after cutover.

### Package G - Cutover (local then VPS)

**Single environment sequence (repeat for local, then VPS)**

1. **Announce freeze** - stop writers (backend and any scripts using SQLite).
2. **Snapshot**
   - Tar/snapshot `agent_os_data` volume (SQLite cold copy).
   - Optional `pg_dump` of DB `twenty` (safety only).
3. **Prepare target**
   - Ensure `flolah` empty or drop/recreate schemas.
   - Apply migrations.
4. **Import** - run migrator; require parity gate.
5. **Config flip**
   - Set `FLOLAH_DATABASE_URL`; remove/disable any SQLite app mode flags.
   - Confirm backend image has no SQLite runtime path for app data.
6. **Start backend** - full smoke (Appendix B).
7. **Soak**
   - Keep SQLite volume **read-only archive** for at least 7 days (or one full backup cycle).
8. **Decommission**
   - After soak: archive SQLite files; strip `better-sqlite3` from **runtime** dependencies if unused (keep only if import tool package still needs it in a tools profile); update deploy docs so `agent_os_data` is not described as the SQL store.

**There is no dual-write.** Temporary dual-read for a shadow comparison only in a non-production rehearsal is allowed; production cutover is hard flip.

**Rollback (within freeze window only)**

1. Stop backend.
2. Restore `AGENT_OS_DATA_DIR` from snapshot if any experimental write dirtied SQLite (should not if freeze held).
3. Deploy previous image / config with SQLite paths.
4. Do **not** attempt partial reverse-sync of Postgres-only writes after production traffic (document as data-loss if rollback after user activity).

---

## 5. Deployment rules (local + VPS)

Align with project rule: **fix in repo and deploy locally and VPS; no hotfixes.**

| Environment | Requirements |
|-------------|--------------|
| **Local compose** | `twenty-db` (or equivalent Postgres 16) + backend with `FLOLAH_DATABASE_URL`; import from local `backend/data` if migrating real data |
| **VPS** | Same image + env via existing deploy scripts; `ensure-*` creates DB/role; backend waits for health |
| **Secrets** | `flolah_app` password in `deploy/.env`; never log connection strings with passwords |
| **Network** | No public publish of 5432; Docker network only |
| **Entitlements** | Unchanged: all post-login APIs remain owner-scoped; Postgres does not introduce unscoped tables |

---

## 6. Risk register and mitigations

| Risk | Mitigation |
|------|------------|
| Sync to async rewrites miss a path | Central client only; ban better-sqlite3 in runtime; PR checklist + ripgrep gate |
| Dialect bugs | Full test pass + staging import of production-sized dump before VPS cutover |
| Tenant merge collisions | Migrator report; prefer platform row if identical key; escalate true conflicts |
| Connection pool starvation under long txs | Bound transactions; set `FLOLAH_DB_POOL_MAX`; avoid holding client across LLM calls |
| Shared host outage affects CRM + Flolah | Accept shared SPOF; document size/RAM; monitor disk on `twenty_db_data` |
| Timestamp formatting drift | Store timestamptz; format at API boundary with existing format helpers |
| Secrets in logs | Reuse redaction helpers; never dump OAuth tokens on parity fail |

---

## 7. Security and multi-tenant rules

- App role **`flolah_app`** may only access database `flolah`.
- SSO continues on **`TWENTY_DATABASE_URL`** with existing twenty credentials - **not** widened to flolah role.
- Schema-level ownership: no Flolah tables in Twenty schemas.
- Post-login routes remain auth + entitlement + `owner_user_id` / CEO scope; Postgres is not a substitute for application authorization.
- BYOK / LLM paths unchanged; only persistence layer moves.

---

## 8. Verification matrix (must all pass)

### 8.1 Data

- [ ] Row-count parity per table (merge rules documented).
- [ ] Spot-check: one CEO full chat history, open kanban board, workflow run, MCP OAuth connected state, Twenty workspace map.
- [ ] IBKR: fills + position snapshots + budgets consistent for a known owner.
- [ ] Admin users can log in; MFA still works.
- [ ] Offboard / retention purge functions operate on Postgres.

### 8.2 Product smoke

- [ ] Login / register / profile
- [ ] Agent chat (history loads and appends)
- [ ] Kanban + workflow run
- [ ] Company workspace + Twenty SSO handoff
- [ ] Content tools invoke + log
- [ ] Scheduled goals / standups if enabled
- [ ] IBKR summary path if entitled
- [ ] Platform admin ops that previously opened the `.db` file

### 8.3 Ops

- [ ] `pg_dump flolah` and restore into clean DB; backend boots
- [ ] Backend restart does not recreate SQLite files for app data
- [ ] VPS verify script green

---

## 9. Implementation order (strict)

```text
A Infra (DB flolah + role + env)
    -> B Async client (no SQLite API for app)
        -> C Versioned migrations / full DDL
            -> D Convert all services/routes/seeds (async + dialect)
                -> E Import tool + parity gates
                    -> F Tests + ops scripts
                        -> G Local cutover
                            -> VPS cutover + soak + decommission SQLite SOR
```

Do not ship Package G until A-F exit criteria are met. Do not ship "Postgres optional mode" in production.

---

## 10. Code map (primary touch points)

| Area | Paths |
|------|--------|
| Schema bootstrap | `backend/src/db/schema.js`, `ceo-db.js`, `request-db.js`, `ceo-db-config.js` |
| New client / migrations | `backend/src/db/client.js`, `backend/src/db/migrations/*` |
| Startup | `backend/src/index.js` |
| Services (high SQL density) | `ibkr-*`, `master-data*`, `mcp-oauth*`, chat/session, kanban/workflows, users/auth, company-business-profile, browser-*, content tool logs |
| Seeds | `backend/src/db/seed-*.js` |
| Migrate tool | `backend/scripts/migrate-sqlite-to-postgres.mjs` (new) |
| Deploy | `deploy/docker-compose.yml`, `deploy/docker-compose.business-core.yml`, `deploy/scripts/ensure-business-core-env.sh`, `deploy/.env.example`, `deploy/README.md` |
| Twenty (unchanged SORs) | `twenty-sso.js`, `twenty-workspace.js`, `twenty-crm.js` |
| OpenSearch (unchanged SORs) | `backend/src/services/opensearch/*` |

---

## 11. Effort guidance

For a complete E2E conversion of this codebase (async surface + dialect + import + dual env deploy): plan **multi-week dedicated engineering**, not a hot weekend switch. Parallelize D (call sites) and E (migrator) after C lands. Size-check production DB files before scheduling freeze.

---

## 12. Final checklist (program complete)

- [ ] Database `flolah` + role `flolah_app` on `twenty-db`
- [ ] Backend uses only `FLOLAH_DATABASE_URL` for app data
- [ ] All historical SQLite app data imported with parity
- [ ] No runtime open of `agent-os.db` / `ceo.db`
- [ ] Tests and VPS smoke on Postgres
- [ ] Backup/restore docs updated
- [ ] SQLite volume archived post-soak
- [ ] This knowledgebase doc status updated to **Implemented** with date

---

## Appendix A - Domain inventory (must migrate)

Use as a living checklist against `schema.js`, `ceo-db.js`, and service `ensure*`.

1. Agents, activities, workspace file registry (metadata), deleted/external agents
2. Chat turns, sessions, session meta, tool-call related rows
3. Standups and delegation tasks / callbacks
4. Kanban tasks, task messages
5. Job applicant / pipeline / workflow tables
6. Platform users, sessions, MFA, step-up, password reset, notifications
7. Agent workflows, A2A, desktop pollers, custom scripts, content tool logs/meta
8. MCP servers, call logs, OAuth configs/tokens
9. IBKR ledger, analytics, monthly guardrails, day plans, market_data_cache
10. Budgets, token_usage, org members, guardrails
11. Browser session, recipes, tasks
12. CEO avatars / VR rooms / media ownership ledgers as currently SQLite-backed
13. Company business profiles / blueprints / industries
14. Master data tables/rows/document side tables still in app DB
15. Caches that are product-visible if loss is unacceptable (summary caches, etc.)
16. Platform settings / feedback / tool model overrides / scheduled goals

Any new table added during migration work must target Postgres only.

---

## Appendix B - Cutover smoke command set (outline)

Exact scripts will live under `backend/scripts` / `deploy/scripts` after implementation. Minimum coverage:

1. Health: API ready + DB `SELECT 1`
2. Auth login token
3. List agents + load recent chat
4. Create kanban card
5. Open company profile with Twenty workspace id still set
6. Owner-scoped list (no cross-tenant leak spot-check as admin)
7. IBKR summary read if applicable

---

## Appendix C - Decision record (locked for E2E plan)

| Decision | Choice |
|----------|--------|
| Required for product to run today? | No - but plan is for full E2E when executed |
| Shared Postgres instance with Twenty? | Yes (`twenty-db`) |
| Flolah location | Database `flolah`, schema `platform` |
| Dual-write during transition? | **No** |
| Partial table migration? | **No** |
| Per-CEO schemas/files after cutover? | **No** (collapsed to owner columns) |
| Keep better-sqlite3 in running backend? | **No** (tools-only if still needed for import) |
| OpenClaw agent SQLite | Out of Flolah SOR scope |

---

## References

- Twenty CRM Postgres ops: `knowledgebase/platform-help/32-business-core-crm-erp.md`, `deploy/business-core/README.md`
- Compose: `deploy/docker-compose.business-core.yml` (`twenty-db`)
- Volume restore (pre-migration SQLite): `deploy/scripts/vps-restore-volumes.sh`
- Implementation plan historical note: `knowledgebase/IMPLEMENTATION_PLAN.md` (SQLite/Postgres aspirational line - this document is the operational truth for the migration)

---

*When implementation ships, set status at top to **Implemented (YYYY-MM-DD)** and link the deploy PR / commit.*