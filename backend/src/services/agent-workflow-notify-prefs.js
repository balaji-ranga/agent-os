/**
 * Owner-scoped Master Data: agent → workflow notification preferences.
 *
 * Table: agent_workflow_notify_prefs
 * Columns: agent_id, workflow_id, enabled
 *
 * Semantics (per agent, within one CEO tenant):
 * - No rows for that agent_id → allow notifications for ALL workflows (default).
 * - One or more rows for that agent_id → allowlist: only matching workflow_id
 *   patterns with enabled truthy may wake / register agent wake.
 *
 * workflow_id may be an exact definition id, a name substring, or a simple
 * glob (* and ?). CEO bell notifications are not gated by this table.
 */
import {
  createTable,
  ensureTableColumns,
  findTableByName,
  listRows,
} from './master-data.js';

export const AGENT_WORKFLOW_NOTIFY_PREFS_TABLE = 'agent_workflow_notify_prefs';
export const AGENT_WORKFLOW_NOTIFY_PREFS_COLUMNS = ['agent_id', 'workflow_id', 'enabled'];

/** Master Data listRows clamps to page size 50 — paginate in listPrefRows. */
const MASTER_DATA_PAGE_SIZE_SAFE = 50;

function norm(s) {
  return String(s || '')
    .trim()
    .toLowerCase();
}

function isEnabledValue(v) {
  const t = String(v ?? 'true')
    .trim()
    .toLowerCase();
  if (!t) return true;
  return !['0', 'false', 'no', 'off', 'disabled'].includes(t);
}

/** Simple glob: * → any run, ? → one char. Case-insensitive. */
export function matchWorkflowPattern(pattern, haystack) {
  const p = norm(pattern);
  const h = norm(haystack);
  if (!p) return false;
  if (!h) return false;
  if (p === '*' || p === '**') return true;
  if (!p.includes('*') && !p.includes('?')) {
    return h === p || h.includes(p) || p.includes(h);
  }
  const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  try {
    return new RegExp('^' + escaped + '$', 'i').test(h);
  } catch {
    return h === p;
  }
}

function agentIdVariants(agentId) {
  const raw = String(agentId || '').trim();
  if (!raw) return [];
  const out = new Set([norm(raw)]);
  // tenant openclaw id: t-ceo-bala--video-orch-ceobala → video-orch-ceobala
  if (raw.includes('--')) {
    const base = raw.split('--').pop();
    if (base) out.add(norm(base));
  }
  // strip t- prefix leftovers
  if (raw.toLowerCase().startsWith('t-') && raw.includes('--')) {
    const base = raw.split('--').pop();
    if (base) out.add(norm(base));
  }
  return [...out];
}

/**
 * Ensure the Knowledge table exists for this CEO (empty = all agents use default allow-all).
 */
export function ensureAgentWorkflowNotifyPrefsTable(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) return null;
  let table = findTableByName(owner, AGENT_WORKFLOW_NOTIFY_PREFS_TABLE);
  if (!table) {
    table = createTable(owner, {
      name: AGENT_WORKFLOW_NOTIFY_PREFS_TABLE,
      description:
        'Per-agent workflow notify allowlist. No rows for an agent = notify all workflows. ' +
        'If rows exist for agent_id, only matching workflow_id patterns (enabled) wake that agent. ' +
        'workflow_id: definition id, name fragment, or glob (e.g. video-reasoning*). CEO bell is always sent.',
      columns: AGENT_WORKFLOW_NOTIFY_PREFS_COLUMNS,
    });
    console.info('[wf-notify-prefs] created table for owner=%s', owner);
  } else {
    try {
      ensureTableColumns(owner, table.id, AGENT_WORKFLOW_NOTIFY_PREFS_COLUMNS);
    } catch (e) {
      console.warn('[wf-notify-prefs] ensure columns', e?.message || e);
    }
  }
  return table;
}

function listPrefRows(ownerUserId) {
  const table = ensureAgentWorkflowNotifyPrefsTable(ownerUserId);
  if (!table?.id) return [];
  const all = [];
  try {
    let offset = 0;
    for (;;) {
      const listed = listRows(ownerUserId, table.id, {
        limit: MASTER_DATA_PAGE_SIZE_SAFE,
        offset,
      });
      const batch = Array.isArray(listed?.rows) ? listed.rows : [];
      all.push(...batch);
      if (batch.length < MASTER_DATA_PAGE_SIZE_SAFE) break;
      offset += MASTER_DATA_PAGE_SIZE_SAFE;
      if (offset >= 2000) break;
    }
  } catch (e) {
    console.warn('[wf-notify-prefs] listRows failed', e?.message || e);
  }
  return all;
}

function prefsForAgent(ownerUserId, agentId) {
  const variants = new Set(agentIdVariants(agentId));
  if (!variants.size) return [];
  const rows = listPrefRows(ownerUserId);
  return rows.filter((r) => variants.has(norm(r?.data?.agent_id)));
}

/**
 * @returns {{ allowed: boolean, mode: 'allow_all'|'allowlist'|'deny', matched?: string|null, reason?: string }}
 */
export function resolveAgentWorkflowNotifyPreference(
  ownerUserId,
  { agentId, definitionId = null, definitionName = null } = {}
) {
  const owner = String(ownerUserId || '').trim();
  const agent = String(agentId || '').trim();
  if (!owner || !agent) {
    return { allowed: true, mode: 'allow_all', reason: 'missing_owner_or_agent' };
  }

  let prefs;
  try {
    prefs = prefsForAgent(owner, agent);
  } catch (e) {
    console.warn('[wf-notify-prefs] resolve failed; default allow', e?.message || e);
    return { allowed: true, mode: 'allow_all', reason: 'prefs_lookup_error' };
  }

  if (!prefs.length) {
    return { allowed: true, mode: 'allow_all' };
  }

  const enabledPrefs = prefs.filter((r) => isEnabledValue(r?.data?.enabled));
  if (!enabledPrefs.length) {
    return {
      allowed: false,
      mode: 'deny',
      reason: 'agent_has_prefs_but_none_enabled',
    };
  }

  const candidates = [definitionId, definitionName].map((x) => String(x || '').trim()).filter(Boolean);
  for (const pref of enabledPrefs) {
    const pattern = String(pref?.data?.workflow_id || '').trim();
    if (!pattern) continue;
    for (const c of candidates) {
      if (matchWorkflowPattern(pattern, c)) {
        return { allowed: true, mode: 'allowlist', matched: pattern };
      }
    }
  }

  return {
    allowed: false,
    mode: 'allowlist',
    matched: null,
    reason: 'workflow_not_in_agent_allowlist',
  };
}

export function agentMayReceiveWorkflowNotify(
  ownerUserId,
  { agentId, definitionId = null, definitionName = null } = {}
) {
  return resolveAgentWorkflowNotifyPreference(ownerUserId, {
    agentId,
    definitionId,
    definitionName,
  }).allowed;
}
