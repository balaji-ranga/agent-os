/**
 * Owner-scoped company identity capture -> Master Data company_memory + strategic_profile.
 * Profile menu: Update Company Details.
 */
import {
  findTableByName,
  createTable,
  listRows,
  insertRow,
  updateRow,
  deleteRow,
} from './master-data.js';
import { ensureStrategyRow, parseJson, persistJourney } from './onboarding-helper.js';
import { ORG_DNA_PRESETS, getSetupGate } from './company-setup.js';
import { listCompanyTypeCards } from './company-blueprints/index.js';

const TABLE_NAME = 'company_memory';
const TABLE_DESC =
  'Shared company memory - mission, DNA, decisions, lessons (not per-employee-only memory).';

const ITEMS = {
  company: 'Company',
  mission: 'Mission',
  dna: 'Organization DNA',
  dna_notes: 'DNA notes',
  industry: 'Industry type',
  build_around_ceo: 'Build around CEO',
};

const BUILD_AROUND_CEO_DETAIL =
  'Human owner sets mission and DNA; AI executives and employees report outcomes via Home, Kanban, and notify_ceo.';

function readStrategic(row) {
  return parseJson(row?.strategic_profile_json, {});
}

function readJourney(row) {
  return parseJson(row?.draft_journey_json, {});
}

function writeStrategicProfile(ownerUserId, strategic) {
  const row = ensureStrategyRow(ownerUserId);
  const journey = readJourney(row);
  persistJourney(ownerUserId, row, journey, {
    strategic_profile_json: JSON.stringify(strategic),
  });
}

function ensureTable(ownerUserId) {
  let table = findTableByName(ownerUserId, TABLE_NAME);
  if (!table) {
    table = createTable(ownerUserId, {
      name: TABLE_NAME,
      description: TABLE_DESC,
      columns: ['item', 'detail'],
    });
    console.info('[company-memory-capture] created table owner=%s id=%s', ownerUserId, table.id);
  }
  return table;
}

function allRows(ownerUserId, tableId) {
  const out = [];
  let offset = 0;
  const limit = 200;
  for (;;) {
    const page = listRows(ownerUserId, tableId, { limit, offset });
    out.push(...(page.rows || []));
    if (!page.rows?.length || out.length >= (page.total || 0)) break;
    offset += limit;
    if (offset > 5000) break;
  }
  return out;
}

function findRowByItem(rows, itemLabel) {
  const want = String(itemLabel || '').trim().toLowerCase();
  return rows.find((r) => String(r.data?.item || '').trim().toLowerCase() === want) || null;
}

export function getCompanyMemoryCapture(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });
  const row = ensureStrategyRow(owner);
  const strategic = readStrategic(row);
  const table = findTableByName(owner, TABLE_NAME);
  let rows = [];
  if (table) {
    rows = allRows(owner, table.id).map((r) => ({
      id: r.id,
      item: r.data?.item || '',
      detail: r.data?.detail || '',
    }));
  }
  const byItem = Object.fromEntries(rows.map((r) => [String(r.item).toLowerCase(), r.detail]));
  const dnaId = strategic.org_dna || null;
  const dnaPreset = ORG_DNA_PRESETS.find((d) => d.id === dnaId) || null;
  return {
    owner_user_id: owner,
    table: table
      ? { id: table.id, name: table.name, row_count: table.row_count, exists: true }
      : { exists: false, name: TABLE_NAME },
    fields: {
      company_name: strategic.company_name || byItem.company || '',
      mission: strategic.mission || byItem.mission || '',
      org_dna: dnaId || '',
      org_dna_label: dnaPreset?.label || '',
      org_dna_notes: strategic.org_dna_notes || byItem['dna notes'] || '',
      company_type:
        strategic.company_type_card || strategic.company_type || byItem['industry type'] || '',
    },
    memory_rows: rows,
    org_dna_presets: ORG_DNA_PRESETS,
    company_types: listCompanyTypeCards(),
    gate: getSetupGate(owner),
  };
}

export function updateCompanyMemoryCapture(ownerUserId, body = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner required'), { status: 400 });
  const company_name = String(body.company_name ?? body.company ?? '').trim();
  const mission = String(body.mission ?? '').trim();
  const org_dna_notes = String(body.org_dna_notes ?? body.dna_notes ?? '').trim();
  let org_dna = String(body.org_dna ?? '').trim();
  const company_type = String(
    body.company_type ?? body.company_type_card ?? body.industry_type ?? ''
  ).trim();
  if (org_dna && !ORG_DNA_PRESETS.some((d) => d.id === org_dna)) {
    throw Object.assign(new Error('Unknown organization DNA id'), { status: 400 });
  }
  const row = ensureStrategyRow(owner);
  const strategic = { ...readStrategic(row) };
  if (Object.prototype.hasOwnProperty.call(body, 'company_name') || Object.prototype.hasOwnProperty.call(body, 'company')) {
    if (company_name) strategic.company_name = company_name;
    else delete strategic.company_name;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'mission')) {
    if (mission) strategic.mission = mission;
    else delete strategic.mission;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'org_dna')) {
    if (org_dna) strategic.org_dna = org_dna;
    else { delete strategic.org_dna; org_dna = ''; }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'org_dna_notes') || Object.prototype.hasOwnProperty.call(body, 'dna_notes')) {
    if (org_dna_notes) strategic.org_dna_notes = org_dna_notes;
    else delete strategic.org_dna_notes;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'company_type') || Object.prototype.hasOwnProperty.call(body, 'company_type_card') || Object.prototype.hasOwnProperty.call(body, 'industry_type')) {
    if (company_type) {
      strategic.company_type_card = company_type;
      strategic.company_type = company_type;
    }
  }
  strategic.company_memory_updated_at = new Date().toISOString();
  writeStrategicProfile(owner, strategic);
  const table = ensureTable(owner);
  const existing = allRows(owner, table.id);
  const effectiveDna = org_dna || strategic.org_dna || '';
  const dnaPreset = ORG_DNA_PRESETS.find((d) => d.id === effectiveDna);
  const nameVal = company_name || strategic.company_name || '';
  const missionVal = mission || strategic.mission || '';
  const notesVal = org_dna_notes || strategic.org_dna_notes || '';
  const industryVal = company_type || strategic.company_type_card || strategic.company_type || '';
  const desired = [];
  if (nameVal) desired.push({ item: ITEMS.company, detail: nameVal });
  if (missionVal) desired.push({ item: ITEMS.mission, detail: missionVal });
  if (dnaPreset) desired.push({ item: ITEMS.dna, detail: dnaPreset.label + ': ' + dnaPreset.seed });
  if (notesVal) desired.push({ item: ITEMS.dna_notes, detail: notesVal });
  if (industryVal) desired.push({ item: ITEMS.industry, detail: String(industryVal) });
  desired.push({ item: ITEMS.build_around_ceo, detail: BUILD_AROUND_CEO_DETAIL });
  let upserted = 0;
  let removed = 0;
  const canonicalItems = new Set(Object.values(ITEMS).map((x) => x.toLowerCase()));
  for (const r of existing) {
    const itemKey = String(r.data?.item || '').trim().toLowerCase();
    if (!canonicalItems.has(itemKey)) continue;
    const stillWanted = desired.some((d) => String(d.item).trim().toLowerCase() === itemKey);
    if (!stillWanted) {
      try { deleteRow(owner, table.id, r.id); removed += 1; }
      catch (e) { console.warn('[company-memory-capture] delete row failed: %s', e.message || e); }
    }
  }
  const afterDelete = allRows(owner, table.id);
  for (const seed of desired) {
    const found = findRowByItem(afterDelete, seed.item);
    if (found) {
      if (String(found.data?.detail || '') !== seed.detail) {
        updateRow(owner, table.id, found.id, { item: seed.item, detail: seed.detail });
      }
      upserted += 1;
    } else {
      insertRow(owner, table.id, seed);
      upserted += 1;
    }
  }
  console.info('[company-memory-capture] update owner=%s upserted=%s removed=%s table=%s', owner, upserted, removed, table.id);
  return { ok: true, owner_user_id: owner, table: { id: table.id, name: table.name }, upserted, removed, capture: getCompanyMemoryCapture(owner) };
}
