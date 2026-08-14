/**
 * Platform-wide agent workspace MD templates (shared across all CEOs — not tenant-scoped).
 * Admin can create/publish; CEOs can apply published templates or publish an agent snapshot.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getDb } from '../db/schema.js';
import * as workspace from '../workspace/adapter.js';
import { ensureTenantOpenClawAgent } from './openclaw-tenant.js';
import { assertUserAgentAccess } from './agent-chat-scope.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SHARED_OPS_PATH = join(REPO_ROOT, 'openclaw-workspace-templates', '_shared', 'AGENT-OS-OPS.md');

/** Workspace MD keys we snapshot / apply (exclude ORG/POLICY — those are CEO-live). */
export const TEMPLATE_FILE_KEYS = ['soul', 'agents', 'memory', 'identity', 'tools', 'ops'];

export const PLATFORM_STANDARD_TEMPLATE_ID = 'platform-standard';

function slugify(name) {
  return (
    String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || `tpl-${Date.now().toString(36)}`
  );
}

function readSharedOps() {
  if (existsSync(SHARED_OPS_PATH)) {
    return readFileSync(SHARED_OPS_PATH, 'utf8');
  }
  return `# Agent OS — shared operating rules\n\n(Call learnings_summary before non-trivial work. Complete Kanban only after real deliverables.)\n`;
}

function buildPlatformStandardFiles() {
  const ops = readSharedOps();
  const soul = `# SOUL — Specialist agent

You are a CEO-scoped specialist. Stay in your stated role; execute work with tools yourself.

## Operating rules

Follow **AGENT-OS-OPS.md** (learnings, Kanban status, summarize_url fallback, Master Data, **ceo_profile** for identity/contact). Also follow TOOLS.md for granted tools.

## Role

- Fulfill requests in your domain for this CEO only.
- Read **ORG.md** for peer agents and tenant session keys.
- Trivial greets / one-line questions → answer immediately; do not invent long deliverables from prior context.

## Boundaries

- Stay in role; escalate to COO when needed.
- Do not invent Master Data tables. Do not mark Kanban completed without the deliverable in your reply.
`;

  const agents = `# AGENTS — Operating contract

## This org (tenancy)

- Read **ORG.md** for agents in this CEO account and peer tenant session keys.
- Use **sessions_send** with tenant keys from ORG.md to reach COO or peers — never bare agent ids.

## Priorities

1. Fulfill requests in your domain.
2. Out of specialty → point the CEO to the right peer in ORG.md (or sessions_send).
3. Use **notify_ceo** only when the CEO asked to be reached, or for a true blocker.
4. For CEO name/email/phone/etc., call **ceo_profile** first (see **AGENT-OS-OPS.md**).
5. Follow **AGENT-OS-OPS.md** and **TOOLS.md** for tools and Kanban.

## Boundaries

- Do not change other agents' SOUL or AGENTS.
- Only interact with agents listed in ORG.md for this CEO.
`;

  const memory = `# MEMORY

## Facts

- Fill in during work: preferences, recurring topics, completed deliverables.

## Recent completions

- Keep brief topic + date lines (last 20–30).
`;

  const identity = `# IDENTITY

- Name and role come from the agent record and SOUL.md.
- You serve one CEO tenant only.
`;

  const tools = `# TOOLS — Agent OS content tools

You have access to **Agent OS content tools** when granted. Invoke each by **tool name with JSON parameters** — never exec/shell, and never open backend API URLs in the browser.

## Shared operating rules

Follow **AGENT-OS-OPS.md** in this workspace for:
- **learnings_summary** before non-trivial work
- Kanban status ownership (\`in_progress\` → \`completed\` only after real deliverable; \`failed\` only when no deliverable)
- summarize_url retries / **browse_*** or browser fallback
- Master Data (list tables first; never invent table names)
- **master_data_rag**: omit \`summarize\` (defaults false) and answer from the returned \`chunks[]\` yourself
- **ceo_profile** for CEO name/email/mobile/etc. (prefer over chat memory; fall back only if profile field empty)
- Client browser session (\`browse_*\`) and Virtual Room media rules

## Granted tools

Your Tool access panel controls which tools you may call. Typical tools include:

- **learnings_summary** — Call first for research / builds / Kanban work (\`topic\`, optional \`days\`).
- **ceo_profile** — CEO account profile (name, email, mobile, region, business). Call before answering identity/contact questions; never invent from chat memory.
- **summarize_url** — Summarize an HTTPS page. On 404/403 try one alternate URL or **browse_task_start** / browser `profile="openclaw"` when granted.
- **generate_image** — Create an image; paste \`![generated](<url>)\` in the same reply (required in Virtual Room too).
- **generate_video** — Short video; include the media URL in the reply.
- **kanban_move_status** / **kanban_create_task** / **kanban_reassign_to_coo** — You decide status; create Kanban only if the CEO asked to track work.
- **notify_ceo** — Only when asked to reach the CEO, or a true blocker. Follow **AGENT-OS-OPS.md** (when to send / how to avoid noise). Prefer \`link_url\` = \`/agents/<your-id>/chat\`.
- **master_data_*** — Call **master_data_list_tables** first for structured tables.
- **master_data_rag** — Document questions: \`{ "query": "<question keywords>" }\`. **Omit \`summarize\`** (defaults \`false\`) and answer from \`chunks[]\` in your own words; pass \`summarize: true\` only when the excerpts are too long or scattered to answer directly. Answer only from excerpts — never invent document content.
- **email_send** — One-off email / calendar invite when granted.

## Client browser session (\`browse_*\`)

When granted (and the CEO has Browser Session / Client Chrome ready), prefer these over inventing scripts. See **AGENT-OS-OPS.md** for recipe vs autonomous rules.

| Tool | Use |
|------|-----|
| **browse_session_status** | Confirm profile / gateway / setup |
| **browse_task_start** | One-off NL goal (\`mode\`: \`autonomous\`) |
| **browse_task_status** | Poll by \`task_id\`; optional \`wait_ms: 90000\` |
| **browse_recipe_list** / **browse_recipe_run** | List / play saved recipes (do not invent recipe names) |
| **browse_snapshot** / **browse_act** | Single-step observe/act |

If the built-in **\`browser\`** tool is **denied** for this agent, never attempt it — use only \`browse_*\`. If \`browser\` is granted, use \`profile="openclaw"\` unless the CEO asked for Client Chrome relay.

**Async pattern:** start → tell the CEO the \`task_id\` immediately → optionally \`browse_task_status\` once with \`wait_ms: 90000\` → report terminal status honestly.

## Choosing the right tool

- Match the tool to the request.
- If a tool fails or is empty, try the next relevant granted tool before giving up.
- Virtual Room: include real media markdown/URLs/chart JSON for every requested deliverable (any chart type).
`;

  return {
    soul,
    agents,
    memory,
    identity,
    tools,
    ops,
  };
}

export function ensurePlatformWorkspaceTemplatesTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_agent_workspace_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
      is_default INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'admin' CHECK (source IN ('platform', 'admin', 'ceo')),
      files_json TEXT NOT NULL DEFAULT '{}',
      created_by TEXT,
      created_by_name TEXT,
      published_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_plat_ws_tpl_status ON platform_agent_workspace_templates(status, updated_at DESC)`
  );
}

function parseFiles(row) {
  try {
    const j = JSON.parse(row.files_json || '{}');
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function rowToPublic(row, { includeFiles = false } = {}) {
  if (!row) return null;
  const out = {
    id: row.id,
    name: row.name,
    description: row.description || '',
    status: row.status,
    is_default: !!row.is_default,
    source: row.source,
    created_by: row.created_by || null,
    created_by_name: row.created_by_name || null,
    published_at: row.published_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    file_keys: Object.keys(parseFiles(row)),
  };
  if (includeFiles) out.files = parseFiles(row);
  return out;
}

/** Seed / refresh the built-in Platform standard template (always published). */
export function seedPlatformStandardWorkspaceTemplate() {
  ensurePlatformWorkspaceTemplatesTable();
  const db = getDb();
  const files = buildPlatformStandardFiles();
  const filesJson = JSON.stringify(files);
  const existing = db
    .prepare(`SELECT id FROM platform_agent_workspace_templates WHERE id = ?`)
    .get(PLATFORM_STANDARD_TEMPLATE_ID);
  if (existing) {
    db.prepare(
      `UPDATE platform_agent_workspace_templates
       SET name = ?, description = ?, status = 'published', is_default = 1, source = 'platform',
           files_json = ?, published_at = COALESCE(published_at, datetime('now')),
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      'Platform standard template',
      'Default workspace MD set: TOOLS, SOUL, AGENTS, MEMORY, IDENTITY, and AGENT-OS-OPS (shared Kanban/learnings/tool rules). Safe starting point for any custom agent.',
      filesJson,
      PLATFORM_STANDARD_TEMPLATE_ID
    );
  } else {
    db.prepare(
      `INSERT INTO platform_agent_workspace_templates
        (id, name, description, status, is_default, source, files_json, created_by, created_by_name, published_at)
       VALUES (?, ?, ?, 'published', 1, 'platform', ?, 'system', 'Platform', datetime('now'))`
    ).run(
      PLATFORM_STANDARD_TEMPLATE_ID,
      'Platform standard template',
      'Default workspace MD set: TOOLS, SOUL, AGENTS, MEMORY, IDENTITY, and AGENT-OS-OPS (shared Kanban/learnings/tool rules). Safe starting point for any custom agent.',
      filesJson
    );
  }
  return getTemplate(PLATFORM_STANDARD_TEMPLATE_ID, { includeFiles: true });
}

export function getTemplate(id, { includeFiles = false } = {}) {
  ensurePlatformWorkspaceTemplatesTable();
  const row = getDb()
    .prepare(`SELECT * FROM platform_agent_workspace_templates WHERE id = ?`)
    .get(id);
  return rowToPublic(row, { includeFiles });
}

/** Published templates visible to CEOs in Agent Workspace. */
export function listPublishedTemplates() {
  ensurePlatformWorkspaceTemplatesTable();
  seedPlatformStandardWorkspaceTemplate();
  return getDb()
    .prepare(
      `SELECT * FROM platform_agent_workspace_templates
       WHERE status = 'published'
       ORDER BY is_default DESC, name COLLATE NOCASE ASC`
    )
    .all()
    .map((r) => rowToPublic(r, { includeFiles: false }));
}

/** Admin: all templates. */
export function listAllTemplates() {
  ensurePlatformWorkspaceTemplatesTable();
  seedPlatformStandardWorkspaceTemplate();
  return getDb()
    .prepare(
      `SELECT * FROM platform_agent_workspace_templates
       ORDER BY is_default DESC, status ASC, updated_at DESC`
    )
    .all()
    .map((r) => rowToPublic(r, { includeFiles: false }));
}

export function createTemplate({ name, description = '', files = {}, status = 'draft', actor }) {
  ensurePlatformWorkspaceTemplatesTable();
  const db = getDb();
  let id = slugify(name);
  if (db.prepare(`SELECT 1 FROM platform_agent_workspace_templates WHERE id = ?`).get(id)) {
    id = `${id}-${Date.now().toString(36).slice(-4)}`;
  }
  const normalized = {};
  for (const k of TEMPLATE_FILE_KEYS) {
    if (files[k] != null) normalized[k] = String(files[k]);
  }
  if (!Object.keys(normalized).length) {
    Object.assign(normalized, buildPlatformStandardFiles());
  }
  const st = status === 'published' ? 'published' : 'draft';
  db.prepare(
    `INSERT INTO platform_agent_workspace_templates
      (id, name, description, status, is_default, source, files_json, created_by, created_by_name, published_at)
     VALUES (?, ?, ?, ?, 0, 'admin', ?, ?, ?, ?)`
  ).run(
    id,
    String(name || '').trim() || id,
    String(description || ''),
    st,
    JSON.stringify(normalized),
    actor?.id || null,
    actor?.name || null,
    st === 'published' ? new Date().toISOString().replace('T', ' ').slice(0, 19) : null
  );
  return getTemplate(id, { includeFiles: true });
}

export function updateTemplate(id, patch, actor) {
  ensurePlatformWorkspaceTemplatesTable();
  const db = getDb();
  const row = db.prepare(`SELECT * FROM platform_agent_workspace_templates WHERE id = ?`).get(id);
  if (!row) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }
  if (row.is_default && patch?.files === undefined && patch?.name === undefined && patch?.description === undefined && patch?.status === undefined) {
    /* allow */
  }
  const name = patch.name != null ? String(patch.name).trim() : row.name;
  const description = patch.description != null ? String(patch.description) : row.description;
  let status = row.status;
  let publishedAt = row.published_at;
  if (patch.status === 'published' || patch.status === 'draft') {
    status = patch.status;
    if (status === 'published' && !publishedAt) {
      publishedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
    }
  }
  let files = parseFiles(row);
  if (patch.files && typeof patch.files === 'object') {
    files = { ...files };
    for (const k of TEMPLATE_FILE_KEYS) {
      if (patch.files[k] != null) files[k] = String(patch.files[k]);
    }
  }
  // Platform standard stays default + published
  if (row.is_default) {
    status = 'published';
  }
  db.prepare(
    `UPDATE platform_agent_workspace_templates
     SET name = ?, description = ?, status = ?, files_json = ?, published_at = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(name, description, status, JSON.stringify(files), publishedAt, id);
  return getTemplate(id, { includeFiles: true });
}

export function deleteTemplate(id) {
  ensurePlatformWorkspaceTemplatesTable();
  const db = getDb();
  const row = db.prepare(`SELECT * FROM platform_agent_workspace_templates WHERE id = ?`).get(id);
  if (!row) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }
  if (row.is_default || row.id === PLATFORM_STANDARD_TEMPLATE_ID) {
    const err = new Error('Cannot delete the Platform standard template');
    err.status = 400;
    throw err;
  }
  db.prepare(`DELETE FROM platform_agent_workspace_templates WHERE id = ?`).run(id);
  return { ok: true, id };
}

/**
 * Snapshot an agent's tenant workspace MD files into a new published platform template.
 */
export async function publishAgentWorkspaceAsTemplate({
  agent,
  ownerUserId,
  name,
  description = '',
  actor,
}) {
  if (!agent?.id) throw new Error('agent required');
  if (!ownerUserId) throw new Error('ownerUserId required');
  ensureTenantOpenClawAgent(agent, ownerUserId);
  const root = workspace.resolveAgentWorkspaceRoot(agent, { ceoUserId: ownerUserId, healDb: false });
  const files = {};
  for (const key of TEMPLATE_FILE_KEYS) {
    try {
      const r = await workspace.readWorkspaceFile(key, { workspaceRoot: root });
      if (r?.text != null && String(r.text).trim()) files[key] = String(r.text);
    } catch {
      /* missing ok */
    }
  }
  if (!Object.keys(files).length) {
    const err = new Error('No workspace MD files to publish (soul/tools/…)');
    err.status = 400;
    throw err;
  }
  ensurePlatformWorkspaceTemplatesTable();
  const db = getDb();
  let id = slugify(name || `${agent.name || agent.id}-template`);
  if (db.prepare(`SELECT 1 FROM platform_agent_workspace_templates WHERE id = ?`).get(id)) {
    id = `${id}-${Date.now().toString(36).slice(-4)}`;
  }
  const tplName = String(name || `${agent.name || agent.id} template`).trim();
  db.prepare(
    `INSERT INTO platform_agent_workspace_templates
      (id, name, description, status, is_default, source, files_json, created_by, created_by_name, published_at)
     VALUES (?, ?, ?, 'published', 0, 'ceo', ?, ?, ?, datetime('now'))`
  ).run(
    id,
    tplName,
    description || `Published from agent ${agent.name || agent.id} by ${actor?.name || ownerUserId}`,
    JSON.stringify(files),
    actor?.id || ownerUserId,
    actor?.name || null
  );
  return getTemplate(id, { includeFiles: true });
}

/**
 * Apply a published (or admin-selected) template onto an agent's tenant workspace.
 * Overwrites template keys; leaves ORG.md / POLICY.md alone.
 */
export async function applyTemplateToAgentWorkspace({
  agent,
  ownerUserId,
  templateId,
  authUser,
}) {
  if (authUser) assertUserAgentAccess(authUser, agent.id);
  const tpl = getTemplate(templateId, { includeFiles: true });
  if (!tpl) {
    const err = new Error('Template not found');
    err.status = 404;
    throw err;
  }
  if (tpl.status !== 'published' && authUser?.role !== 'admin') {
    const err = new Error('Template is not published');
    err.status = 400;
    throw err;
  }
  const ensured = ensureTenantOpenClawAgent(agent, ownerUserId);
  const root = ensured.workspacePath || workspace.resolveAgentWorkspaceRoot(agent, {
    ceoUserId: ownerUserId,
    healDb: false,
  });
  const written = [];
  const files = tpl.files || {};
  for (const key of TEMPLATE_FILE_KEYS) {
    if (files[key] == null) continue;
    await workspace.writeWorkspaceFile(key, files[key], { workspaceRoot: root });
    written.push(key);
  }
  return {
    ok: true,
    template_id: tpl.id,
    template_name: tpl.name,
    workspace_root: String(root).replace(/\\/g, '/'),
    written,
  };
}
