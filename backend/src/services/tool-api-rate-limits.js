/**
 * Per-CEO call budgets for tools that consume external API keys / tokens.
 * Independent of per-agent monthly token budget (unchanged).
 *
 * Limits are optional: unset max_calls_per_day / max_calls_per_month = unlimited.
 * Actuals auto-reset at day/month boundary (PLATFORM_TIMEZONE / TZ / UTC) with an audit row
 * of budget vs actuals taken before zeroing. CEOs can also reset from Tools UI.
 */
import { getDb } from '../db/schema.js';
import { resolveToolOwnerUserIdOrNull, resolveEntitledOwnerUserId } from './tool-owner-scope.js';
import { resolveAuthenticatedCeoUserId } from '../middleware/auth.js';
import { TOOL_MODEL_MAPPABLE } from './tool-model-overrides.js';

function listToolsMetaInternal() {
  try {
    return getDb()
      .prepare(
        `SELECT name, display_name, endpoint, purpose, is_builtin, auth_header
         FROM content_tools_meta`
      )
      .all();
  } catch {
    return [];
  }
}

const BROWSER_FALLBACK_HINT =
  'Try alternate options like Browser Session (browse_task_start / browse_recipe_run) or server Playwright.';

/** Explicit catalog: paid / vendor API or external call token. browse_* is the fallback, not listed. */
export const TOOL_API_RATE_LIMIT_CATALOG = Object.freeze([
  { name: 'summarize_url', label: 'Summarize URL', kind: 'llm_api', provider: 'LLM' },
  { name: 'analyze_image', label: 'Analyze image', kind: 'llm_api', provider: 'Vision LLM' },
  { name: 'generate_image', label: 'Generate image', kind: 'image', provider: 'OpenAI / image API' },
  { name: 'generate_video', label: 'Generate video', kind: 'video', provider: 'Replicate' },
  { name: 'video_media_generate', label: 'Video media generate (S4)', kind: 'video', provider: 'Replicate / Flow' },
  { name: 'learnings_summary', label: 'Learnings summary', kind: 'llm_api', provider: 'LLM' },
  { name: 'brain_history', label: 'Brain history', kind: 'llm_api', provider: 'LLM' },
  { name: 'master_data_rag', label: 'Master Data RAG (summarize)', kind: 'llm_api', provider: 'LLM' },
  { name: 'intent_classify_and_delegate', label: 'Intent classify & delegate', kind: 'llm_api', provider: 'LLM' },
  { name: 'agent_workflow_certify_start', label: 'Workflow certify (Maker)', kind: 'llm_api', provider: 'LLM' },
  { name: 'ibkr_order_learnings', label: 'IBKR order learnings', kind: 'llm_api', provider: 'LLM' },
  { name: 'job_fit_score', label: 'Job fit score', kind: 'llm_api', provider: 'LLM' },
  { name: 'job_tailor_resume', label: 'Job tailor resume', kind: 'llm_api', provider: 'LLM' },
  { name: 'job_phase1_submit_ceo_review', label: 'Job phase-1 CEO review', kind: 'llm_api', provider: 'LLM' },
  { name: 'job_ceo_review_include', label: 'Job CEO review include', kind: 'llm_api', provider: 'LLM' },
  { name: 'job_run_workflow_now', label: 'Job run workflow now', kind: 'llm_api', provider: 'LLM' },
  { name: 'job_portal_harvest_listings', label: 'Job portal harvest', kind: 'job', provider: 'Job portals' },
  { name: 'brave_web_search', label: 'Brave Web Search', kind: 'search', provider: 'Brave' },
  { name: 'google_places_geocode', label: 'Google Places geocode', kind: 'places', provider: 'Google Places' },
  { name: 'google_places_nearby', label: 'Google Places nearby', kind: 'places', provider: 'Google Places' },
  { name: 'business_discover', label: 'Business discover', kind: 'places', provider: 'Google Places' },
  { name: 'social_research_search', label: 'Social research search', kind: 'social', provider: 'Social / search' },
  { name: 'social_research_instagram', label: 'Social research Instagram', kind: 'social', provider: 'Instagram' },
  { name: 'social_research_x', label: 'Social research X', kind: 'social', provider: 'X API' },
  { name: 'social_research_facebook', label: 'Social research Facebook', kind: 'social', provider: 'Facebook' },
  { name: 'social_research_profile', label: 'Social research profile', kind: 'social', provider: 'Social' },
  { name: 'web_scrape_url', label: 'Web scrape URL', kind: 'scrape', provider: 'Crawlee sidecar' },
  { name: 'web_scrape_domain', label: 'Web scrape domain', kind: 'scrape', provider: 'Crawlee sidecar' },
  { name: 'email_send', label: 'Send email', kind: 'email', provider: 'SMTP' },
  { name: 'connector_list_apps', label: 'Connectors — list apps', kind: 'connector', provider: 'OpenConnector' },
  { name: 'connector_search_actions', label: 'Connectors — search actions', kind: 'connector', provider: 'OpenConnector' },
  { name: 'connector_get_action_guide', label: 'Connectors — action guide', kind: 'connector', provider: 'OpenConnector' },
  { name: 'connector_execute_action', label: 'Connectors — execute action', kind: 'connector', provider: 'OpenConnector' },
  { name: 'market_regime', label: 'Market regime', kind: 'market', provider: 'FMP' },
  { name: 'market_screener', label: 'Market screener', kind: 'market', provider: 'FMP' },
  { name: 'market_history', label: 'Market history', kind: 'market', provider: 'FMP' },
  { name: 'market_fundamentals', label: 'Market fundamentals', kind: 'market', provider: 'FMP' },
]);

const STATIC_SET = new Set(TOOL_API_RATE_LIMIT_CATALOG.map((t) => t.name));
const BROWSE_SKIP = /^browse_/;

const PREFIX_KIND = [
  ['crm_', 'crm', 'CRM'],
  ['erp_', 'erp', 'ERP'],
  ['ibkr_', 'ibkr', 'IBKR'],
  ['market_', 'market', 'FMP'],
  ['social_research_', 'social', 'Social'],
  ['google_places_', 'places', 'Google Places'],
  ['connector_', 'connector', 'OpenConnector'],
  ['job_', 'job', 'Job APIs'],
  ['web_scrape_', 'scrape', 'Web scrape'],
];

function parseIntOrNull(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function periodKeys(now = new Date()) {
  const tz = String(process.env.PLATFORM_TIMEZONE || process.env.TZ || 'UTC').trim() || 'UTC';
  let day = '';
  try {
    day = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    day = now.toISOString().slice(0, 10);
  }
  return { day, month: day.slice(0, 7), tz };
}

function kindForName(name, metaRow = null) {
  const n = String(name || '');
  const staticHit = TOOL_API_RATE_LIMIT_CATALOG.find((t) => t.name === n);
  if (staticHit) return staticHit.kind;
  for (const [prefix, kind] of PREFIX_KIND) {
    if (n.startsWith(prefix)) return kind;
  }
  if (metaRow && !metaRow.is_builtin) return 'custom';
  return 'api';
}

function providerForName(name, metaRow = null) {
  const n = String(name || '');
  const staticHit = TOOL_API_RATE_LIMIT_CATALOG.find((t) => t.name === n);
  if (staticHit) return staticHit.provider;
  for (const [prefix, , provider] of PREFIX_KIND) {
    if (n.startsWith(prefix)) return provider;
  }
  if (metaRow?.auth_header) return 'External token';
  return 'External API';
}

/**
 * Tools that consume vendor API keys / call tokens (plus custom onboarded HTTP APIs).
 * Excludes Browser Session tools (the suggested fallback when a limit is hit).
 */
export function isToolApiRateLimitable(toolName, metaRow = null) {
  const name = String(toolName || '').trim();
  if (!name || BROWSE_SKIP.test(name)) return false;
  if (STATIC_SET.has(name)) return true;
  if (TOOL_MODEL_MAPPABLE.some((t) => t.name === name) && !BROWSE_SKIP.test(name)) return true;
  for (const [prefix] of PREFIX_KIND) {
    if (name.startsWith(prefix)) return true;
  }
  if (name === 'business_discover' || name === 'email_send' || name === 'video_media_generate') {
    return true;
  }
  let row = metaRow;
  if (!row) {
    try {
      row =
        getDb()
          .prepare(
            'SELECT name, endpoint, is_builtin, auth_header FROM content_tools_meta WHERE name = ?'
          )
          .get(name) || null;
    } catch {
      row = null;
    }
  }
  if (row) {
    if (row.auth_header) return true;
    const ep = String(row.endpoint || '');
    if (!row.is_builtin && ep && !ep.startsWith('/api/')) return true;
  }
  return false;
}

export function listRateLimitableToolDefs() {
  const meta = listToolsMetaInternal();
  const metaByName = new Map(meta.map((t) => [t.name, t]));
  const out = [];
  const seen = new Set();

  const push = (name, extra = {}) => {
    if (!name || seen.has(name) || BROWSE_SKIP.test(name)) return;
    const m = metaByName.get(name) || null;
    if (!isToolApiRateLimitable(name, m)) return;
    seen.add(name);
    const cat = TOOL_API_RATE_LIMIT_CATALOG.find((t) => t.name === name);
    out.push({
      name,
      label: extra.label || cat?.label || m?.display_name || name,
      kind: extra.kind || kindForName(name, m),
      provider: extra.provider || providerForName(name, m),
      description: extra.description || cat?.description || m?.purpose || '',
    });
  };

  for (const def of TOOL_API_RATE_LIMIT_CATALOG) push(def.name, def);
  for (const t of TOOL_MODEL_MAPPABLE) {
    if (t.name !== 'browse_task_start') push(t.name, { kind: t.kind === 'chat' ? 'llm_api' : t.kind });
  }
  for (const m of meta) push(m.name);

  out.sort((a, b) => String(a.kind).localeCompare(b.kind) || String(a.label).localeCompare(b.label));
  return out;
}

function insertResetAudit({
  ownerUserId,
  toolName,
  resetKind,
  period,
  budgetMaxDay,
  budgetMaxMonth,
  actualsDay,
  actualsMonth,
  periodDay,
  periodMonth,
  resetBy,
}) {
  getDb()
    .prepare(
      `INSERT INTO tool_api_rate_limit_resets (
         owner_user_id, tool_name, reset_kind, period,
         budget_max_day, budget_max_month, actuals_day, actuals_month,
         period_day, period_month, reset_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ownerUserId,
      toolName,
      resetKind,
      period,
      budgetMaxDay ?? null,
      budgetMaxMonth ?? null,
      actualsDay ?? 0,
      actualsMonth ?? 0,
      periodDay || null,
      periodMonth || null,
      resetBy || null
    );
}

/**
 * Apply due day/month rollovers for one row. Must run inside a transaction.
 * @returns {number} audit rows written
 */
function applyRowRollover(row, keys, { resetBy = 'auto' } = {}) {
  if (!row) return 0;
  let audits = 0;
  const owner = row.owner_user_id;
  const name = row.tool_name;
  let callsToday = Number(row.calls_today) || 0;
  let callsMonth = Number(row.calls_this_month) || 0;
  let periodDay = row.period_day || null;
  let periodMonth = row.period_month || null;

  if (periodMonth && periodMonth !== keys.month) {
    insertResetAudit({
      ownerUserId: owner,
      toolName: name,
      resetKind: 'auto_month',
      period: 'month',
      budgetMaxDay: row.max_calls_per_day,
      budgetMaxMonth: row.max_calls_per_month,
      actualsDay: callsToday,
      actualsMonth: callsMonth,
      periodDay,
      periodMonth,
      resetBy,
    });
    callsMonth = 0;
    periodMonth = keys.month;
    audits += 1;
  } else if (!periodMonth) {
    periodMonth = keys.month;
  }

  if (periodDay && periodDay !== keys.day) {
    insertResetAudit({
      ownerUserId: owner,
      toolName: name,
      resetKind: 'auto_day',
      period: 'day',
      budgetMaxDay: row.max_calls_per_day,
      budgetMaxMonth: row.max_calls_per_month,
      actualsDay: callsToday,
      actualsMonth: callsMonth,
      periodDay,
      periodMonth,
      resetBy,
    });
    callsToday = 0;
    periodDay = keys.day;
    audits += 1;
  } else if (!periodDay) {
    periodDay = keys.day;
  }

  if (audits > 0 || row.period_day !== periodDay || row.period_month !== periodMonth) {
    getDb()
      .prepare(
        `UPDATE tool_api_rate_limits
         SET calls_today = ?, calls_this_month = ?, period_day = ?, period_month = ?, updated_at = datetime('now')
         WHERE owner_user_id = ? AND tool_name = ?`
      )
      .run(callsToday, callsMonth, periodDay, periodMonth, owner, name);
    row.calls_today = callsToday;
    row.calls_this_month = callsMonth;
    row.period_day = periodDay;
    row.period_month = periodMonth;
  }
  return audits;
}

export function applyDueToolRateLimitResets({ ownerUserId = null, resetBy = 'cron' } = {}) {
  const keys = periodKeys();
  const db = getDb();
  const rows = ownerUserId
    ? db
        .prepare('SELECT * FROM tool_api_rate_limits WHERE owner_user_id = ?')
        .all(String(ownerUserId))
    : db.prepare('SELECT * FROM tool_api_rate_limits').all();
  let scanned = 0;
  let resetRows = 0;
  const run = db.transaction(() => {
    for (const row of rows) {
      scanned += 1;
      resetRows += applyRowRollover(row, keys, { resetBy });
    }
  });
  run();
  if (resetRows) {
    console.info(
      '[tool-api-rate-limit] auto-reset audits=%s scanned=%s day=%s month=%s',
      resetRows,
      scanned,
      keys.day,
      keys.month
    );
  }
  return { ok: true, scanned, audits: resetRows, day: keys.day, month: keys.month, tz: keys.tz };
}

function getLimitRow(ownerUserId, toolName) {
  return (
    getDb()
      .prepare('SELECT * FROM tool_api_rate_limits WHERE owner_user_id = ? AND tool_name = ?')
      .get(ownerUserId, toolName) || null
  );
}

function lastResetFor(ownerUserId, toolName) {
  return (
    getDb()
      .prepare(
        `SELECT reset_kind, period, budget_max_day, budget_max_month, actuals_day, actuals_month,
                period_day, period_month, reset_by, created_at
         FROM tool_api_rate_limit_resets
         WHERE owner_user_id = ? AND tool_name = ?
         ORDER BY id DESC LIMIT 1`
      )
      .get(ownerUserId, toolName) || null
  );
}

export function listToolApiRateLimitResets(ownerUserId, { toolName = null, limit = 50 } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner required');
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  if (toolName) {
    return getDb()
      .prepare(
        `SELECT id, tool_name, reset_kind, period, budget_max_day, budget_max_month,
                actuals_day, actuals_month, period_day, period_month, reset_by, created_at
         FROM tool_api_rate_limit_resets
         WHERE owner_user_id = ? AND tool_name = ?
         ORDER BY id DESC LIMIT ?`
      )
      .all(owner, String(toolName), lim);
  }
  return getDb()
    .prepare(
      `SELECT id, tool_name, reset_kind, period, budget_max_day, budget_max_month,
              actuals_day, actuals_month, period_day, period_month, reset_by, created_at
       FROM tool_api_rate_limit_resets
       WHERE owner_user_id = ?
       ORDER BY id DESC LIMIT ?`
    )
    .all(owner, lim);
}

export function listToolApiRateLimits(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner required');
  const keys = periodKeys();
  const db = getDb();
  const stored = db
    .prepare('SELECT * FROM tool_api_rate_limits WHERE owner_user_id = ?')
    .all(owner);
  const run = db.transaction(() => {
    for (const row of stored) applyRowRollover(row, keys, { resetBy: 'lazy' });
  });
  run();
  const fresh = db
    .prepare('SELECT * FROM tool_api_rate_limits WHERE owner_user_id = ?')
    .all(owner);
  const byName = new Map(fresh.map((r) => [r.tool_name, r]));
  const tools = listRateLimitableToolDefs().map((def) => {
    const row = byName.get(def.name);
    const maxDay = row?.max_calls_per_day != null ? Number(row.max_calls_per_day) : null;
    const maxMonth = row?.max_calls_per_month != null ? Number(row.max_calls_per_month) : null;
    return {
      name: def.name,
      label: def.label,
      kind: def.kind,
      provider: def.provider,
      description: def.description,
      max_calls_per_day: Number.isFinite(maxDay) ? maxDay : null,
      max_calls_per_month: Number.isFinite(maxMonth) ? maxMonth : null,
      calls_today: Number(row?.calls_today) || 0,
      calls_this_month: Number(row?.calls_this_month) || 0,
      period_day: row?.period_day || keys.day,
      period_month: row?.period_month || keys.month,
      limited: (Number.isFinite(maxDay) && maxDay > 0) || (Number.isFinite(maxMonth) && maxMonth > 0),
      last_reset: lastResetFor(owner, def.name),
      updated_at: row?.updated_at || null,
    };
  });
  return {
    owner_user_id: owner,
    day: keys.day,
    month: keys.month,
    tz: keys.tz,
    tools,
  };
}

export function putToolApiRateLimits(ownerUserId, mappings) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner required');
  if (!Array.isArray(mappings)) throw new Error('mappings must be an array');
  const keys = periodKeys();
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO tool_api_rate_limits (
       owner_user_id, tool_name, max_calls_per_day, max_calls_per_month,
       calls_today, calls_this_month, period_day, period_month, updated_at
     ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, datetime('now'))`
  );
  const updateMax = db.prepare(
    `UPDATE tool_api_rate_limits
     SET max_calls_per_day = ?, max_calls_per_month = ?, updated_at = datetime('now')
     WHERE owner_user_id = ? AND tool_name = ?`
  );
  const del = db.prepare('DELETE FROM tool_api_rate_limits WHERE owner_user_id = ? AND tool_name = ?');

  const run = db.transaction(() => {
    for (const item of mappings) {
      const name = String(item?.tool_name || item?.name || '').trim();
      if (!name) throw new Error('tool_name required');
      if (!isToolApiRateLimitable(name)) {
        throw new Error('Tool is not rate-limitable (API key / external token tools only): ' + name);
      }
      const maxDay = parseIntOrNull(item?.max_calls_per_day ?? item?.maxCallsPerDay);
      const maxMonth = parseIntOrNull(item?.max_calls_per_month ?? item?.maxCallsPerMonth);
      if (maxDay != null && maxDay > 1_000_000) throw new Error(name + ': max_calls_per_day too large');
      if (maxMonth != null && maxMonth > 10_000_000) throw new Error(name + ': max_calls_per_month too large');
      if ((maxDay == null || maxDay === 0) && (maxMonth == null || maxMonth === 0)) {
        del.run(owner, name);
        continue;
      }
      const dayVal = maxDay && maxDay > 0 ? maxDay : null;
      const monthVal = maxMonth && maxMonth > 0 ? maxMonth : null;
      const existing = getLimitRow(owner, name);
      if (existing) {
        applyRowRollover(existing, keys, { resetBy: 'lazy' });
        updateMax.run(dayVal, monthVal, owner, name);
      } else {
        insert.run(owner, name, dayVal, monthVal, keys.day, keys.month);
      }
    }
  });
  run();
  console.info('[tool-api-rate-limit] saved owner=%s count=%s', owner, mappings.length);
  return listToolApiRateLimits(owner);
}

export function resetToolApiRateLimit(ownerUserId, toolName, { period = 'both', resetBy = 'user' } = {}) {
  const owner = String(ownerUserId || '').trim();
  const name = String(toolName || '').trim();
  if (!owner) throw new Error('owner required');
  if (!name) throw new Error('tool_name required');
  const p = String(period || 'both').toLowerCase();
  if (!['day', 'month', 'both'].includes(p)) throw new Error('period must be day, month, or both');
  const keys = periodKeys();
  const db = getDb();
  const run = db.transaction(() => {
    let row = getLimitRow(owner, name);
    if (!row) {
      return { ok: true, skipped: 'no_limit_row', tool_name: name };
    }
    applyRowRollover(row, keys, { resetBy: 'lazy' });
    row = getLimitRow(owner, name);
    const kind = p === 'both' ? 'manual_both' : p === 'day' ? 'manual_day' : 'manual_month';
    insertResetAudit({
      ownerUserId: owner,
      toolName: name,
      resetKind: kind,
      period: p,
      budgetMaxDay: row.max_calls_per_day,
      budgetMaxMonth: row.max_calls_per_month,
      actualsDay: Number(row.calls_today) || 0,
      actualsMonth: Number(row.calls_this_month) || 0,
      periodDay: row.period_day,
      periodMonth: row.period_month,
      resetBy: resetBy || owner,
    });
    const nextDay = p === 'month' ? Number(row.calls_today) || 0 : 0;
    const nextMonth = p === 'day' ? Number(row.calls_this_month) || 0 : 0;
    db.prepare(
      `UPDATE tool_api_rate_limits
       SET calls_today = ?, calls_this_month = ?, period_day = ?, period_month = ?, updated_at = datetime('now')
       WHERE owner_user_id = ? AND tool_name = ?`
    ).run(nextDay, nextMonth, keys.day, keys.month, owner, name);
    return { ok: true, tool_name: name, period: p, reset_kind: kind };
  });
  const out = run();
  console.info('[tool-api-rate-limit] manual reset owner=%s tool=%s period=%s', owner, name, p);
  return { ...out, ...listToolApiRateLimits(owner) };
}

function blockedPayload({ toolName, period, limit, actual, day, month }) {
  const periodLabel = period === 'month' ? 'month' : 'day';
  const error =
    `Tool rate limit reached for ${periodLabel} on ${toolName} (${actual}/${limit}). ${BROWSER_FALLBACK_HINT}`;
  return {
    ok: false,
    error,
    code: 'tool_rate_limit_reached',
    period: periodLabel,
    tool_name: toolName,
    limit,
    actual,
    day,
    month,
    retry_hint: BROWSER_FALLBACK_HINT,
  };
}

/**
 * Generic pre-flight for any tool. No-ops when the tool is not rate-limitable or has no budget.
 * On success, consumes one call (increments day + month actuals).
 *
 * @returns {{ ok: true, skipped?: string, calls_today?: number, calls_this_month?: number } | { ok: false, error: string, code: string, status: number }}
 */
export function assertAndConsumeToolRateLimit({ ownerUserId, toolName, actor = 'tool' } = {}) {
  const name = String(toolName || '').trim();
  const owner = String(ownerUserId || '').trim();
  if (!name) return { ok: true, skipped: 'no_tool' };
  if (!isToolApiRateLimitable(name)) return { ok: true, skipped: 'not_limitable' };
  if (!owner) return { ok: true, skipped: 'no_owner' };

  const keys = periodKeys();
  const db = getDb();
  try {
    const result = db.transaction(() => {
      let row = getLimitRow(owner, name);
      if (!row) return { ok: true, skipped: 'unlimited' };
      applyRowRollover(row, keys, { resetBy: 'lazy' });
      row = getLimitRow(owner, name);
      if (!row) return { ok: true, skipped: 'unlimited' };

      const maxDay = row.max_calls_per_day != null ? Number(row.max_calls_per_day) : null;
      const maxMonth = row.max_calls_per_month != null ? Number(row.max_calls_per_month) : null;
      const hasDay = Number.isFinite(maxDay) && maxDay > 0;
      const hasMonth = Number.isFinite(maxMonth) && maxMonth > 0;
      if (!hasDay && !hasMonth) return { ok: true, skipped: 'unlimited' };

      const callsToday = Number(row.calls_today) || 0;
      const callsMonth = Number(row.calls_this_month) || 0;

      if (hasDay && callsToday >= maxDay) {
        return {
          ...blockedPayload({
            toolName: name,
            period: 'day',
            limit: maxDay,
            actual: callsToday,
            day: keys.day,
            month: keys.month,
          }),
          status: 429,
        };
      }
      if (hasMonth && callsMonth >= maxMonth) {
        return {
          ...blockedPayload({
            toolName: name,
            period: 'month',
            limit: maxMonth,
            actual: callsMonth,
            day: keys.day,
            month: keys.month,
          }),
          status: 429,
        };
      }

      const nextDay = callsToday + 1;
      const nextMonth = callsMonth + 1;
      db.prepare(
        `UPDATE tool_api_rate_limits
         SET calls_today = ?, calls_this_month = ?, period_day = ?, period_month = ?, updated_at = datetime('now')
         WHERE owner_user_id = ? AND tool_name = ?`
      ).run(nextDay, nextMonth, keys.day, keys.month, owner, name);
      return {
        ok: true,
        consumed: true,
        calls_today: nextDay,
        calls_this_month: nextMonth,
        max_calls_per_day: hasDay ? maxDay : null,
        max_calls_per_month: hasMonth ? maxMonth : null,
      };
    })();

    if (result?.ok === false) {
      console.warn(
        '[tool-api-rate-limit] blocked owner=%s tool=%s period=%s actual=%s limit=%s actor=%s',
        owner,
        name,
        result.period,
        result.actual,
        result.limit,
        actor
      );
    }
    return result;
  } catch (e) {
    console.warn('[tool-api-rate-limit] validator failed tool=%s: %s', name, e?.message || e);
    return { ok: true, skipped: 'validator_error' };
  }
}

function resolveToolNameFromRequest(req) {
  const original = String(req.originalUrl || req.url || '').split('?')[0];
  const path = String(req.path || '').split('?')[0];
  const meta = listToolsMetaInternal();
  for (const t of meta) {
    const ep = String(t.endpoint || '')
      .split('?')[0]
      .replace(/\/$/, '');
    if (!ep) continue;
    if (original === ep || original.replace(/\/$/, '') === ep) return t.name;
    if (ep.endsWith(path) && path.length > 1) return t.name;
  }
  const bodyName = String(req.body?.tool_name || req.body?.toolName || '').trim();
  if (bodyName) return bodyName;
  return null;
}

function logBlockedCall(req, toolName, payload, ownerUserId) {
  try {
    const source = (
      req.headers['x-openclaw-agent-id'] ||
      req.headers['x-agent-id'] ||
      ''
    )
      .toString()
      .trim() || null;
    getDb()
      .prepare(
        `INSERT INTO content_tool_logs (tool_name, source, request_payload, response_payload, status, owner_user_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        toolName,
        source,
        JSON.stringify({ rate_limit_precheck: true }),
        JSON.stringify(payload),
        'error',
        ownerUserId || null
      );
  } catch (_) {}
}

/**
 * Generic Express middleware: resolve tool from route, check per-user call budget, consume 1.
 * Skip /invoke (proxies to the dedicated route which is the single consume point).
 */
export function toolApiRateLimitMiddleware(req, res, next) {
  if (req.method === 'OPTIONS' || req.method === 'HEAD') return next();
  const path = String(req.path || '');
  if (path === '/invoke' || path.startsWith('/invoke/')) return next();
  if (path.startsWith('/rate-limits') || path.startsWith('/model-mappings')) return next();

  const toolName = resolveToolNameFromRequest(req);
  if (!toolName || !isToolApiRateLimitable(toolName)) return next();

  let ownerUserId = null;
  try {
    ownerUserId = resolveToolOwnerUserIdOrNull(req, req.body || {}, resolveAuthenticatedCeoUserId);
  } catch (_) {
    ownerUserId = null;
  }
  if (!ownerUserId) {
    try {
      ownerUserId = resolveEntitledOwnerUserId(req, { fallbackToBala: false }) || null;
    } catch (_) {
      ownerUserId = null;
    }
  }
  if (!ownerUserId) {
    try {
      ownerUserId = String(req.headers['x-ceo-user-id'] || req.headers['x-agent-os-user-id'] || '').trim() || null;
    } catch {
      ownerUserId = null;
    }
  }

  const check = assertAndConsumeToolRateLimit({
    ownerUserId,
    toolName,
    actor: 'http',
  });
  if (check?.ok === false) {
    logBlockedCall(req, toolName, check, ownerUserId);
    return res.status(Number(check.status) || 429).json(check);
  }
  req.toolApiRateLimit = check;
  return next();
}
