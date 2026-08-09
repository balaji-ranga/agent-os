/**
 * Workspace Builder — JSON components, data bindings, default publish.
 * schema_version 2 enables AI workers / Workflow Builder to design workspaces later.
 */
import { getDb } from '../db/schema.js';
import { getDbForCeo } from '../db/request-db.js';
import { listAgentsForUser } from './users.js';
import { kanbanOwnerSqlFilter } from './kanban-user-scope.js';
import { getBusinessProfile } from './company-business-profile.js';
import { getTwentyStatusForOwner } from './twenty-crm.js';

export const SCHEMA_VERSION = 2;
export const LAYOUT_MODES = ['grid', 'single', 'two_column', 'header_plus_grid'];

/** Allowed relative REST endpoints for bindings (no absolute URLs / SSRF). */
export const REST_ALLOWLIST = [
  { prefix: '/company-workspace/snapshot', methods: ['GET'] },
  { prefix: '/this-week-digest', methods: ['GET'] },
  { prefix: '/home/snapshot', methods: ['GET'] },
  { prefix: '/efficiency/summary', methods: ['GET'] },
  { prefix: '/efficiency/agents', methods: ['GET'] },
  { prefix: '/master-data/tables', methods: ['GET'] },
];

export function isRestAllowlisted(endpoint) {
  const ep = String(endpoint || '')
    .trim()
    .split('?')[0];
  return REST_ALLOWLIST.some((r) => ep === r.prefix || ep.startsWith(r.prefix + '/'));
}

/** Component catalog for Workspace Builder palette. */
export const COMPONENT_CATALOG = [
  { type: 'kpi_card', title: 'KPI Card', category: 'viz', icon: 'kpi', default: { w: 3, h: 2 }, description: 'Single metric with delta' },
  { type: 'line_chart', title: 'Line Chart', category: 'viz', icon: 'line', default: { w: 6, h: 5 }, description: 'Trend line' },
  { type: 'bar_chart', title: 'Bar Chart', category: 'viz', icon: 'bar', default: { w: 6, h: 5 }, description: 'Category bars' },
  { type: 'donut_chart', title: 'Donut Chart', category: 'viz', icon: 'donut', default: { w: 4, h: 5 }, description: 'Share breakdown' },
  { type: 'data_table', title: 'Table', category: 'data', icon: 'table', default: { w: 6, h: 6 }, description: 'Tabular rows' },
  { type: 'data_grid', title: 'Data Grid', category: 'data', icon: 'grid', default: { w: 6, h: 6 }, description: 'Grid with progress' },
  { type: 'activity_feed', title: 'Activity Feed', category: 'data', icon: 'feed', default: { w: 4, h: 6 }, description: 'Recent events' },
  { type: 'task_list', title: 'Task List', category: 'data', icon: 'tasks', default: { w: 4, h: 6 }, description: 'Open Kanban work' },
  { type: 'agent_list', title: 'AI Workers', category: 'data', icon: 'users', default: { w: 4, h: 6 }, description: 'Team / agents' },
  { type: 'metrics_row', title: 'Metrics Row', category: 'viz', icon: 'metrics', default: { w: 12, h: 2 }, description: 'Row of workspace metrics' },
  { type: 'text_block', title: 'Text Block', category: 'content', icon: 'text', default: { w: 4, h: 2 }, description: 'Static text / notes' },
  { type: 'chat_panel', title: 'Chat Panel', category: 'chat', icon: 'chat', default: { w: 12, h: 2 }, description: 'Command bar to AI' },
  { type: 'filter_bar', title: 'Filter', category: 'content', icon: 'filter', default: { w: 12, h: 1 }, description: 'Filter placeholder' },
  { type: 'tabs', title: 'Tabs', category: 'layout', icon: 'tabs', default: { w: 12, h: 1 }, description: 'Tab headers' },
  { type: 'quick_links', title: 'Quick Links', category: 'content', icon: 'links', default: { w: 12, h: 2 }, description: 'Deep links' },
  { type: 'metrics_header', title: 'Metrics (legacy)', category: 'legacy', icon: 'metrics', default: { w: 12, h: 2 }, description: 'v1 metrics header' },
  { type: 'team_strip', title: 'Team strip (legacy)', category: 'legacy', icon: 'users', default: { w: 12, h: 2 }, description: 'v1 team strip' },
  { type: 'open_work', title: 'Open work (legacy)', category: 'legacy', icon: 'tasks', default: { w: 6, h: 6 }, description: 'v1 open work' },
  { type: 'activity', title: 'Activity (legacy)', category: 'legacy', icon: 'feed', default: { w: 6, h: 6 }, description: 'v1 activity' },
  { type: 'spend_pulse', title: 'Spend pulse', category: 'legacy', icon: 'kpi', default: { w: 6, h: 3 }, description: 'Token spend' },
  { type: 'customers_pulse', title: 'Customers pulse', category: 'legacy', icon: 'kpi', default: { w: 6, h: 3 }, description: 'CRM status' },
  { type: 'notes_card', title: 'Notes card', category: 'content', icon: 'text', default: { w: 6, h: 3 }, description: 'Static notes' },
];

/** @deprecated alias */
export const WIDGET_CATALOG = COMPONENT_CATALOG.map((c) => ({
  type: c.type,
  title: c.title,
  description: c.description,
  layouts: ['half', 'full'],
  data_keys: [],
  category: c.category,
  default: c.default,
}));

/** Recreates hard-coded /work operating workspace via JSON components. */
export function defaultOperatingWorkspaceBoard() {
  return {
    schema_version: SCHEMA_VERSION,
    slug: 'operating-workspace',
    name: 'Operating Workspace',
    layout: { mode: 'grid', columns: 12, row_height: 48, gap: 12 },
    components: [
      {
        id: 'm1',
        type: 'metrics_row',
        title: 'At a glance',
        x: 0,
        y: 0,
        w: 12,
        h: 2,
        props: {},
        binding: { source: 'preset', preset: 'workspace.metrics' },
      },
      {
        id: 't1',
        type: 'task_list',
        title: 'My tasks',
        x: 0,
        y: 2,
        w: 4,
        h: 7,
        props: { limit: 12 },
        binding: { source: 'preset', preset: 'workspace.tasks' },
      },
      {
        id: 'a1',
        type: 'agent_list',
        title: 'AI workforce',
        x: 4,
        y: 2,
        w: 4,
        h: 7,
        props: {},
        binding: { source: 'preset', preset: 'workspace.agents' },
      },
      {
        id: 'f1',
        type: 'activity_feed',
        title: 'Recent AI activity',
        x: 8,
        y: 2,
        w: 4,
        h: 7,
        props: { limit: 15 },
        binding: { source: 'preset', preset: 'workspace.activity' },
      },
      {
        id: 'c1',
        type: 'chat_panel',
        title: 'Command',
        x: 0,
        y: 9,
        w: 12,
        h: 2,
        props: { placeholder: 'Message COO or @mention an AI worker' },
        binding: { source: 'none' },
      },
    ],
  };
}

export function defaultThisWeekBoard() {
  const op = defaultOperatingWorkspaceBoard();
  return { ...op, slug: 'this-week', name: 'This week (legacy board)' };
}

export function ensureWorkspaceBoardTables(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS company_workspace_boards (
      owner_user_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      layout_json TEXT NOT NULL DEFAULT '{}',
      widgets_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (owner_user_id, slug)
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_boards_owner
      ON company_workspace_boards(owner_user_id);
  `);
  const cols = db.prepare('PRAGMA table_info(company_workspace_boards)').all().map((c) => c.name);
  if (!cols.includes('is_default')) {
    db.exec('ALTER TABLE company_workspace_boards ADD COLUMN is_default INTEGER DEFAULT 0');
  }
  if (!cols.includes('published')) {
    db.exec('ALTER TABLE company_workspace_boards ADD COLUMN published INTEGER DEFAULT 0');
  }
  if (!cols.includes('schema_version')) {
    db.exec('ALTER TABLE company_workspace_boards ADD COLUMN schema_version INTEGER DEFAULT 2');
  }
}

function parseJson(raw, fallback) {
  try {
    const v = JSON.parse(raw || '');
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function allowedTypes() {
  return new Set(COMPONENT_CATALOG.map((c) => c.type));
}

function normalizeComponent(raw, i) {
  const type = String(raw?.type || '').trim();
  const cat = COMPONENT_CATALOG.find((c) => c.type === type);
  const def = cat?.default || { w: 4, h: 3 };
  const binding = raw?.binding && typeof raw.binding === 'object' ? { ...raw.binding } : { source: 'none' };
  let source = String(binding.source || 'none').toLowerCase();
  if (!['none', 'preset', 'rest', 'master_data_table', 'master_data_rag', 'inline'].includes(source)) {
    source = 'none';
  }
  binding.source = source;
  let w = Number(raw?.w);
  let h = Number(raw?.h);
  if (!Number.isFinite(w) || w < 1) w = raw?.span === 'full' ? 12 : def.w;
  if (!Number.isFinite(h) || h < 1) h = def.h;
  return {
    id: String(raw?.id || 'c' + (i + 1)).slice(0, 64),
    type,
    title: String(raw?.title || cat?.title || type).slice(0, 120),
    x: Math.max(0, Math.min(11, Number(raw?.x) || 0)),
    y: Math.max(0, Number(raw?.y) || 0),
    w: Math.max(1, Math.min(12, Math.round(w))),
    h: Math.max(1, Math.min(24, Math.round(h))),
    props:
      raw?.props && typeof raw.props === 'object'
        ? raw.props
        : raw?.config && typeof raw.config === 'object'
          ? raw.config
          : {},
    binding,
  };
}

function rowToBoard(row, owner) {
  const layout = parseJson(row.layout_json, { mode: 'grid', columns: 12 });
  let components = parseJson(row.widgets_json, []);
  if (
    Array.isArray(components) &&
    components.length &&
    components[0] &&
    components[0].type &&
    components[0].w == null &&
    components[0].span
  ) {
    let y = 0;
    components = components.map((w, i) => {
      const full = w.span === 'full';
      const c = normalizeComponent(
        { ...w, w: full ? 12 : 6, h: full ? 2 : 5, x: full ? 0 : (i % 2) * 6, y },
        i
      );
      y += c.h;
      return c;
    });
  } else {
    components = (Array.isArray(components) ? components : []).map((c, i) => normalizeComponent(c, i));
  }
  return {
    owner_user_id: owner,
    slug: row.slug,
    name: row.name,
    schema_version: Number(row.schema_version) || layout.schema_version || SCHEMA_VERSION,
    layout: {
      mode: layout.mode || 'grid',
      columns: Number(layout.columns) || 12,
      row_height: Number(layout.row_height) || 48,
      gap: Number(layout.gap) || 12,
      schema_version: SCHEMA_VERSION,
    },
    components,
    widgets: components,
    is_default: !!row.is_default,
    published: !!row.published || !!row.is_default,
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}

export function getBoard(ownerUserId, slug = 'operating-workspace') {
  ensureWorkspaceBoardTables();
  const owner = String(ownerUserId || '').trim();
  const s = String(slug || 'operating-workspace').trim() || 'operating-workspace';
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });
  const row = getDb()
    .prepare('SELECT * FROM company_workspace_boards WHERE owner_user_id = ? AND slug = ?')
    .get(owner, s);
  if (!row) {
    if (s === 'operating-workspace' || s === 'work') {
      const def = defaultOperatingWorkspaceBoard();
      return {
        ...def,
        owner_user_id: owner,
        is_default: false,
        published: false,
        widgets: def.components,
        updated_at: null,
        created_at: null,
        synthetic: true,
      };
    }
    if (s === 'this-week') {
      const def = defaultThisWeekBoard();
      return {
        ...def,
        owner_user_id: owner,
        is_default: false,
        published: false,
        widgets: def.components,
        synthetic: true,
      };
    }
    return null;
  }
  return rowToBoard(row, owner);
}

export function getDefaultWorkspaceBoard(ownerUserId) {
  ensureWorkspaceBoardTables();
  const owner = String(ownerUserId || '').trim();
  const row = getDb()
    .prepare(
      'SELECT * FROM company_workspace_boards WHERE owner_user_id = ? AND is_default = 1 ORDER BY updated_at DESC LIMIT 1'
    )
    .get(owner);
  if (!row) return null;
  return rowToBoard(row, owner);
}

export function listBoards(ownerUserId) {
  ensureWorkspaceBoardTables();
  const owner = String(ownerUserId || '').trim();
  const rows = getDb()
    .prepare(
      'SELECT slug, name, updated_at, is_default, published, schema_version FROM company_workspace_boards WHERE owner_user_id = ? ORDER BY name'
    )
    .all(owner);
  const list = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    updated_at: r.updated_at,
    is_default: !!r.is_default,
    published: !!r.published || !!r.is_default,
    schema_version: r.schema_version || 2,
  }));
  if (!list.some((r) => r.slug === 'operating-workspace')) {
    list.unshift({
      slug: 'operating-workspace',
      name: 'Operating Workspace',
      updated_at: null,
      is_default: false,
      published: false,
      synthetic: true,
    });
  }
  return list;
}

export function saveBoard(ownerUserId, slug, input = {}) {
  ensureWorkspaceBoardTables();
  const owner = String(ownerUserId || '').trim();
  const s = String(slug || '')
    .trim()
    .slice(0, 64);
  if (!owner || !s) throw Object.assign(new Error('owner and slug required'), { status: 400 });
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(s)) {
    throw Object.assign(new Error('slug must be alphanumeric with - _'), { status: 400 });
  }
  const types = allowedTypes();
  const layoutIn = input.layout && typeof input.layout === 'object' ? input.layout : {};
  const layoutObj = {
    mode: LAYOUT_MODES.includes(layoutIn.mode) ? layoutIn.mode : 'grid',
    columns: Number(layoutIn.columns) || 12,
    row_height: Number(layoutIn.row_height) || 48,
    gap: Number(layoutIn.gap) || 12,
    schema_version: SCHEMA_VERSION,
  };
  const list = Array.isArray(input.components)
    ? input.components
    : Array.isArray(input.widgets)
      ? input.widgets
      : [];
  const normalized = [];
  for (let i = 0; i < list.length; i++) {
    const type = String(list[i]?.type || '').trim();
    if (!types.has(type)) {
      throw Object.assign(new Error('Unknown component type: ' + type), { status: 400 });
    }
    const b = list[i]?.binding;
    if (b && b.source === 'rest') {
      if (!isRestAllowlisted(b.endpoint)) {
        throw Object.assign(new Error('REST endpoint not allowlisted: ' + b.endpoint), { status: 400 });
      }
    }
    normalized.push(normalizeComponent(list[i], i));
  }
  const boardName = String(input.name || s).trim().slice(0, 120) || s;
  let pubVal = 0;
  if (input.published === true || input.published === 1) pubVal = 1;
  else if (input.published === false || input.published === 0) pubVal = 0;
  else {
    const existing = getDb()
      .prepare('SELECT published FROM company_workspace_boards WHERE owner_user_id = ? AND slug = ?')
      .get(owner, s);
    pubVal = existing?.published ? 1 : 0;
  }
  getDb()
    .prepare(
      `INSERT INTO company_workspace_boards
         (owner_user_id, slug, name, layout_json, widgets_json, schema_version, published, is_default, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT is_default FROM company_workspace_boards WHERE owner_user_id = ? AND slug = ?), 0), datetime('now'), datetime('now'))
       ON CONFLICT(owner_user_id, slug) DO UPDATE SET
         name = excluded.name,
         layout_json = excluded.layout_json,
         widgets_json = excluded.widgets_json,
         schema_version = excluded.schema_version,
         published = excluded.published,
         updated_at = datetime('now')`
    )
    .run(
      owner,
      s,
      boardName,
      JSON.stringify(layoutObj),
      JSON.stringify(normalized),
      SCHEMA_VERSION,
      pubVal,
      owner,
      s
    );
  console.info('[workspace-boards] saved owner=%s slug=%s components=%s', owner, s, normalized.length);
  return getBoard(owner, s);
}

export function setDefaultBoard(ownerUserId, slug) {
  ensureWorkspaceBoardTables();
  const owner = String(ownerUserId || '').trim();
  const s = String(slug || '').trim();
  if (!owner || !s) throw Object.assign(new Error('owner and slug required'), { status: 400 });
  let board = getBoard(owner, s);
  if (!board) throw Object.assign(new Error('Board not found'), { status: 404 });
  if (board.synthetic) {
    board = saveBoard(owner, s, {
      name: board.name,
      layout: board.layout,
      components: board.components,
      published: true,
    });
  }
  const db = getDb();
  db.prepare(
    "UPDATE company_workspace_boards SET is_default = 0, updated_at = datetime('now') WHERE owner_user_id = ?"
  ).run(owner);
  db.prepare(
    "UPDATE company_workspace_boards SET is_default = 1, published = 1, updated_at = datetime('now') WHERE owner_user_id = ? AND slug = ?"
  ).run(owner, s);
  console.info('[workspace-boards] default owner=%s slug=%s', owner, s);
  return getBoard(owner, s);
}

export function deleteBoard(ownerUserId, slug) {
  ensureWorkspaceBoardTables();
  const owner = String(ownerUserId || '').trim();
  const s = String(slug || '').trim();
  if (!owner || !s) throw Object.assign(new Error('owner and slug required'), { status: 400 });
  getDb().prepare('DELETE FROM company_workspace_boards WHERE owner_user_id = ? AND slug = ?').run(owner, s);
  console.info('[workspace-boards] deleted owner=%s slug=%s', owner, s);
  return { ok: true };
}

function getByPath(obj, path) {
  if (!path) return obj;
  const parts = String(path).split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function weekBounds(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diffToMon));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

export async function hydrateBoardData(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  const week = weekBounds();
  const ownerFilter = kanbanOwnerSqlFilter({ id: owner, role: 'ceo' });
  const ceoDb = getDbForCeo(owner);
  const business = getBusinessProfile(owner);
  const twenty = getTwentyStatusForOwner(owner);

  let tasks = [];
  let openCount = 0;
  try {
    tasks = ceoDb
      .prepare(
        `SELECT k.id, k.title, k.status, k.assigned_agent_id, k.due_date, k.created_at, k.updated_at
         FROM kanban_tasks k
         WHERE ${ownerFilter.clause}
         ORDER BY COALESCE(k.updated_at, k.created_at) DESC
         LIMIT 80`
      )
      .all(...ownerFilter.params);
    openCount = tasks.filter((t) => {
      const st = String(t.status || '').toLowerCase();
      return !['done', 'completed', 'cancelled', 'archived', 'failed'].includes(st);
    }).length;
  } catch (e) {
    console.warn('[workspace-boards] tasks', e?.message || e);
  }

  const closed = new Set(['done', 'completed', 'cancelled', 'archived', 'failed']);
  const tasksOpen = tasks.filter((t) => !closed.has(String(t.status || '').toLowerCase())).slice(0, 40);
  const tasksWeek = tasks
    .filter((t) => {
      const st = String(t.status || '').toLowerCase();
      if (closed.has(st)) return false;
      if (!t.due_date) return true;
      const due = String(t.due_date).slice(0, 10);
      return due >= week.start_date && due < week.end_date;
    })
    .slice(0, 25);

  let agents = [];
  try {
    agents = (listAgentsForUser(owner) || []).map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      department: a.department || '',
      is_coo: !!a.is_coo,
      role_title: a.role_title || a.role || '',
    }));
  } catch (e) {
    console.warn('[workspace-boards] agents', e?.message || e);
  }

  let spend = null;
  try {
    const { getEfficiencySummary } = await import('./efficiency.js');
    const summary = await getEfficiencySummary(owner, { days: 7 });
    spend = {
      window_days: 7,
      total_tokens: summary?.totals?.tokens ?? summary?.total_tokens ?? null,
      total_cost_usd: summary?.totals?.cost_usd ?? summary?.total_cost_usd ?? null,
      agents_with_usage: Array.isArray(summary?.agents) ? summary.agents.length : null,
      href: '/efficiency',
    };
  } catch (e) {
    console.warn('[workspace-boards] spend', e?.message || e);
    spend = { error: e?.message || String(e), href: '/efficiency' };
  }

  let activity = tasks
    .filter((t) => ['completed', 'failed', 'done'].includes(String(t.status || '').toLowerCase()))
    .slice(0, 20)
    .map((t) => ({
      id: 'kanban-' + t.id,
      kind: 'kanban',
      snippet: String(t.status) + ': ' + String(t.title || '').slice(0, 100),
      text: String(t.status) + ': ' + String(t.title || '').slice(0, 100),
      created_at: t.updated_at || t.created_at,
      task_id: t.id,
      status: t.status,
    }));

  try {
    const runs = getDb()
      .prepare(
        `SELECT r.id, r.status, r.completed_at, r.updated_at, r.started_at, d.name AS definition_name
         FROM agent_workflow_runs r
         LEFT JOIN agent_workflow_definitions d ON d.id = r.definition_id
         WHERE r.owner_user_id = ?
           AND lower(COALESCE(r.status,'')) IN ('completed','failed','error')
         ORDER BY COALESCE(r.completed_at, r.updated_at) DESC
         LIMIT 20`
      )
      .all(owner);
    for (const r of runs) {
      activity.push({
        id: 'wf-' + r.id,
        kind: 'workflow',
        snippet: (r.definition_name || 'Workflow') + ' ' + r.status,
        text: (r.definition_name || 'Workflow') + ' ' + r.status,
        created_at: r.completed_at || r.updated_at || r.started_at,
        status: r.status,
      });
    }
    activity.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    activity = activity.slice(0, 25);
  } catch (e) {
    console.warn('[workspace-boards] wf activity', e?.message || e);
  }

  const customers = {
    crm_enabled: !!business.crm_enabled,
    crm_ready: !!(twenty?.bound || business?.twenty?.bound),
    erp_enabled: !!business.erp_enabled,
    message: business.crm_enabled
      ? 'CRM is enabled for this company.'
      : 'Enable CRM in Profile Business Core to see customers here.',
    href: business.crm_enabled ? '/crm' : '/profile',
  };

  let digest = null;
  try {
    const { buildThisWeekDigest } = await import('./this-week-digest.js');
    digest = await buildThisWeekDigest(owner, {});
  } catch (e) {
    console.warn('[workspace-boards] digest hydrate', e?.message || e);
  }

  return {
    owner_user_id: owner,
    week,
    metrics: {
      tasks_open: openCount,
      tasks_week: tasksWeek.length,
      tasks_listed: tasksOpen.length,
      agents_active: agents.length,
      crm_enabled: !!business.crm_enabled,
      erp_enabled: !!business.erp_enabled,
    },
    agents,
    tasks: tasksOpen,
    tasks_week: tasksWeek,
    activity,
    spend,
    customers,
    digest,
    links: {
      home: '/',
      this_week: '/this-week',
      work: '/work',
      kanban: '/kanban',
      ai_employees: '/workspace',
      efficiency: '/efficiency',
      crm: '/crm',
      design: '/workspace-designer',
    },
    entitlements: {
      crm: !!business.crm_enabled,
      erp: !!business.erp_enabled,
    },
  };
}

async function resolveBinding(ownerUserId, binding, context) {
  const b = binding || { source: 'none' };
  const source = b.source || 'none';
  if (source === 'none' || source === 'inline') {
    return { ok: true, value: b.value ?? null };
  }
  if (source === 'preset') {
    const preset = String(b.preset || '');
    const map = {
      'workspace.metrics': context.metrics,
      'workspace.metrics.tasks_open': context.metrics?.tasks_open,
      'workspace.metrics.agents_active': context.metrics?.agents_active,
      'workspace.metrics.crm_enabled': context.metrics?.crm_enabled,
      'workspace.metrics.erp_enabled': context.metrics?.erp_enabled,
      'workspace.tasks': context.tasks,
      'workspace.tasks_week': context.tasks_week,
      'workspace.agents': context.agents,
      'workspace.activity': context.activity,
      'workspace.spend': context.spend,
      'workspace.customers': context.customers,
      'workspace.links': context.links,
      'digest.kpis': context.digest?.kpis,
      'digest.performance': context.digest?.performance,
      'digest.performance.slices': context.digest?.performance?.slices,
      'digest.top_workflows': context.digest?.top_workflows,
      'digest.activity': context.digest?.activity,
      'digest.insights': context.digest?.insights,
    };
    if (Object.prototype.hasOwnProperty.call(map, preset)) {
      return { ok: true, value: map[preset] };
    }
    if (preset.startsWith('workspace.') || preset.startsWith('digest.')) {
      const path = preset.replace(/^workspace\./, '').replace(/^digest\./, '');
      const root = preset.startsWith('digest.') ? context.digest : context;
      return { ok: true, value: getByPath(root, path) };
    }
    return { ok: false, error: 'Unknown preset: ' + preset };
  }
  if (source === 'rest') {
    const endpoint = String(b.endpoint || '');
    if (!isRestAllowlisted(endpoint)) return { ok: false, error: 'Endpoint not allowlisted' };
    if (endpoint.startsWith('/company-workspace/snapshot')) {
      return { ok: true, value: getByPath(context, b.path || '') };
    }
    if (endpoint.startsWith('/this-week-digest')) {
      const path = (b.path || '').replace(/^\./, '');
      return { ok: true, value: path ? getByPath(context.digest, path) : context.digest };
    }
    return { ok: false, error: 'REST path not resolvable in-process' };
  }
  if (source === 'master_data_table') {
    try {
      const tableId = String(b.table_id || b.tableId || '');
      if (!tableId) return { ok: false, error: 'table_id required' };
      const md = await import('./master-data.js');
      const limit = Math.min(50, Number(b.limit) || 20);
      let value = null;
      if (typeof md.queryTable === 'function') {
        value = md.queryTable(ownerUserId, tableId, {
          query: b.query || '',
          column: b.column || null,
          equals: b.equals || null,
          limit,
          offset: 0,
        });
      } else if (typeof md.getTableRows === 'function') {
        value = md.getTableRows(ownerUserId, tableId, { limit });
      } else {
        value = { error: 'queryTable not available', tableId };
      }
      return { ok: true, value };
    } catch (e) {
      console.warn('[workspace-boards] md_table', e?.message || e);
      return { ok: false, error: e?.message || String(e) };
    }
  }
  if (source === 'master_data_rag') {
    try {
      const md = await import('./master-data.js');
      const q = String(b.rag_query || b.query || b.queryTemplate || '').trim();
      if (!q) return { ok: false, error: 'rag_query required' };
      let value = null;
      if (typeof md.runMasterDataQuery === 'function') {
        value = await md.runMasterDataQuery(
          ownerUserId,
          { mode: 'rag', topK: Number(b.top_k || b.topK) || 5, summarize: !!b.summarize },
          { query: q }
        );
      } else {
        value = { query: q, results: [], note: 'RAG helper not available' };
      }
      return { ok: true, value };
    } catch (e) {
      console.warn('[workspace-boards] md_rag', e?.message || e);
      return { ok: false, error: e?.message || String(e) };
    }
  }
  return { ok: false, error: 'Unsupported binding source' };
}

export async function renderBoard(ownerUserId, slug) {
  const board = getBoard(ownerUserId, slug);
  if (!board) throw Object.assign(new Error('Board not found'), { status: 404 });
  const context = await hydrateBoardData(ownerUserId);
  const components = [];
  for (const c of board.components || board.widgets || []) {
    const resolved = await resolveBinding(ownerUserId, c.binding, context);
    components.push({
      ...c,
      data: resolved.ok ? resolved.value : null,
      data_error: resolved.ok ? null : resolved.error || 'failed',
    });
  }
  const filtered = filterWidgetsForEntitlements(components, context.entitlements);
  console.info(
    '[workspace-boards] render owner=%s slug=%s components=%s',
    ownerUserId,
    slug,
    filtered.length
  );
  return {
    board: { ...board, components: filtered, widgets: filtered },
    data: context,
    components: filtered,
    owner_user_id: ownerUserId,
  };
}

export function filterWidgetsForEntitlements(widgets, entitlements = {}) {
  return (widgets || []).filter((w) => {
    const req = w.requires || w.props?.requires;
    if (!req) return true;
    if (req === 'crm' && !entitlements.crm) return false;
    if (req === 'erp' && !entitlements.erp) return false;
    return true;
  });
}

export function materializeOperatingTemplate(ownerUserId) {
  const def = defaultOperatingWorkspaceBoard();
  return saveBoard(ownerUserId, def.slug, {
    name: def.name,
    layout: def.layout,
    components: def.components,
    published: true,
  });
}
