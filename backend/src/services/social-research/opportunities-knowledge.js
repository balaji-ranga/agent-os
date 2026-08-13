/**
 * Owner-scoped Knowledge table of discovered business opportunities.
 * Used so Business Discovery does not re-recommend the same lead to CRM.
 */
import {
  createTable,
  ensureTableColumns,
  findTableByName,
  insertRow,
  listRows,
  updateRow,
} from '../master-data.js';

export const OPPORTUNITIES_TABLE = 'discovered_opportunities';

export const OPPORTUNITIES_COLUMNS = [
  'fingerprint',
  'place_id',
  'business_name',
  'locality',
  'business_type',
  'rating',
  'user_rating_count',
  'website',
  'instagram',
  'linkedin',
  'facebook',
  'google_maps_uri',
  'phone',
  'address',
  'status',
  'kanban_task_id',
  'discovered_at',
  'researched_at',
  'research_json',
  'notes',
];

export function fingerprintFor({ place_id, business_name, name, locality } = {}) {
  const pid = String(place_id || '').trim().toLowerCase();
  if (pid) return `place:${pid}`;
  const nameSlug = String(business_name || name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const loc = String(locality || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `name:${nameSlug}|${loc}`;
}

export function ensureOpportunitiesTable(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });
  let table = findTableByName(owner, OPPORTUNITIES_TABLE);
  if (!table) {
    table = createTable(owner, {
      name: OPPORTUNITIES_TABLE,
      description:
        'Business Discovery identified opportunities. Dedup key is fingerprint/place_id. CRM employees must not recreate leads that already appear here or in CRM.',
      columns: OPPORTUNITIES_COLUMNS,
    });
    console.info('[social-research] created knowledge table=%s owner=%s', OPPORTUNITIES_TABLE, owner);
  } else {
    try {
      ensureTableColumns(owner, table.id, OPPORTUNITIES_COLUMNS);
    } catch (e) {
      console.warn('[social-research] ensure opportunity columns: %s', e.message || e);
    }
  }
  return table;
}

function listAllRows(owner, tableId) {
  const all = [];
  let offset = 0;
  for (;;) {
    const page = listRows(owner, tableId, { limit: 50, offset });
    const rows = page?.rows || [];
    if (!rows.length) break;
    all.push(...rows);
    if (rows.length < 50) break;
    offset += 50;
    if (offset > 5000) break;
  }
  return all;
}

export function loadOpportunityIndex(ownerUserId) {
  const table = ensureOpportunitiesTable(ownerUserId);
  const rows = listAllRows(ownerUserId, table.id);
  const byFingerprint = new Map();
  const byPlaceId = new Map();
  for (const row of rows) {
    const data = row.data || row.row_json || {};
    const parsed = typeof data === 'string' ? safeJson(data) : data;
    const fp = String(parsed.fingerprint || '').trim();
    const pid = String(parsed.place_id || '').trim();
    const rec = { id: row.id, ...parsed };
    if (fp) byFingerprint.set(fp, rec);
    if (pid) byPlaceId.set(pid, rec);
  }
  return { table, rows: rows.map((r) => ({ id: r.id, ...(typeof r.data === 'object' ? r.data : {}) })), byFingerprint, byPlaceId };
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export function lookupOpportunity(index, lead) {
  const pid = String(lead.place_id || '').trim();
  if (pid && index.byPlaceId.has(pid)) return index.byPlaceId.get(pid);
  const fp = fingerprintFor(lead);
  if (fp && index.byFingerprint.has(fp)) return index.byFingerprint.get(fp);
  return null;
}

export function recordOpportunities(ownerUserId, leads, { status = 'identified', kanbanTaskId = null } = {}) {
  const table = ensureOpportunitiesTable(ownerUserId);
  const index = loadOpportunityIndex(ownerUserId);
  const now = new Date().toISOString();
  const written = [];
  const skipped = [];
  for (const lead of leads || []) {
    const existing = lookupOpportunity(index, lead);
    const fp = fingerprintFor(lead);
    const payload = {
      fingerprint: fp,
      place_id: lead.place_id || '',
      business_name: lead.name || lead.business_name || '',
      locality: lead.locality || '',
      business_type: lead.business_type || '',
      rating: lead.rating != null ? String(lead.rating) : '',
      user_rating_count: lead.user_rating_count != null ? String(lead.user_rating_count) : '',
      website: lead.website || '',
      instagram: lead.instagram || '',
      linkedin: lead.linkedin || '',
      facebook: lead.facebook || '',
      google_maps_uri: lead.google_maps_uri || '',
      phone: lead.phone || '',
      address: lead.address || '',
      status,
      kanban_task_id: kanbanTaskId != null ? String(kanbanTaskId) : existing?.kanban_task_id || '',
      discovered_at: existing?.discovered_at || now,
      researched_at: lead.researched_at || now,
      research_json: lead.research_json || existing?.research_json || '',
      notes: lead.notes || existing?.notes || '',
    };
    if (existing?.id) {
      try {
        updateRow(ownerUserId, table.id, existing.id, payload);
        skipped.push({ ...payload, row_id: existing.id, previously_identified: true });
      } catch (e) {
        console.warn('[social-research] update opportunity failed: %s', e.message || e);
      }
      continue;
    }
    try {
      const ins = insertRow(ownerUserId, table.id, payload);
      written.push({ ...payload, row_id: ins.row?.id, previously_identified: false });
    } catch (e) {
      console.warn('[social-research] insert opportunity failed: %s', e.message || e);
    }
  }
  console.info(
    '[social-research] opportunities owner=%s new=%s existing=%s',
    ownerUserId,
    written.length,
    skipped.length
  );
  return { table_id: table.id, table_name: OPPORTUNITIES_TABLE, written, skipped };
}
