import { api } from '../api';
import { DEPARTMENT_PRESETS } from '../utils/orgHierarchy.js';

export const DEPARTMENTS_TABLE_NAME = 'departments';
export const DEPARTMENTS_COLUMN = 'name';

function normalizeName(name) {
  return String(name || '').trim();
}

function rowName(row) {
  const data = row?.data || {};
  return normalizeName(data.name ?? data.Name ?? data.department ?? data.Department ?? '');
}

/**
 * When duplicates exist, pick one canonical table:
 * most rows → newest updated_at → oldest created_at → id.
 * (Same rule as backend pickCanonicalTable.)
 */
export function pickCanonicalTable(tables = []) {
  const list = Array.isArray(tables) ? [...tables] : [];
  if (!list.length) return null;
  list.sort((a, b) => {
    const rc = (b.row_count || 0) - (a.row_count || 0);
    if (rc !== 0) return rc;
    const ub = String(b.updated_at || '');
    const ua = String(a.updated_at || '');
    if (ub !== ua) return ub > ua ? 1 : -1;
    const ca = String(a.created_at || '');
    const cb = String(b.created_at || '');
    if (ca !== cb) return ca < cb ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });
  return list[0];
}

async function listAllRows(tableId) {
  const all = [];
  let offset = 0;
  for (;;) {
    const page = await api.masterDataTableGet(tableId, { limit: 50, offset });
    const rows = page.rows || [];
    all.push(...rows);
    const total = page.total ?? all.length;
    offset += rows.length;
    if (!rows.length || offset >= total) break;
  }
  return all;
}

/**
 * Find or create the CEO's master-data table named "departments".
 * If multiple "departments" tables exist (legacy), uses the canonical one only.
 * Seeds DEPARTMENT_PRESETS on first create (or when empty).
 */
export async function ensureDepartmentsTable() {
  const listed = await api.masterDataTables();
  const matches = (listed.tables || []).filter(
    (t) => String(t.name || '').trim().toLowerCase() === DEPARTMENTS_TABLE_NAME
  );
  let table = pickCanonicalTable(matches);
  if (!table) {
    const created = await api.masterDataTableCreate({
      name: DEPARTMENTS_TABLE_NAME,
      columns: [DEPARTMENTS_COLUMN],
      description: 'Org departments for agent onboarding (dynamic list)',
    });
    table = created.table;
    for (const name of DEPARTMENT_PRESETS) {
      await api.masterDataRowInsert(table.id, { [DEPARTMENTS_COLUMN]: name });
    }
    const refreshed = await api.masterDataTableGet(table.id, { limit: 1, offset: 0 });
    table = refreshed.table || table;
  } else if ((table.row_count || 0) === 0) {
    for (const name of DEPARTMENT_PRESETS) {
      await api.masterDataRowInsert(table.id, { [DEPARTMENTS_COLUMN]: name });
    }
    const refreshed = await api.masterDataTableGet(table.id, { limit: 1, offset: 0 });
    table = refreshed.table || table;
  }
  return { table, duplicates: matches.length > 1 ? matches : [] };
}

/**
 * @returns {{ table: object, departments: Array<{ id: number, name: string }>, duplicates: object[] }}
 */
export async function loadDepartments() {
  const { table, duplicates } = await ensureDepartmentsTable();
  const rows = await listAllRows(table.id);
  const departments = rows
    .map((r) => ({ id: r.id, name: rowName(r) }))
    .filter((d) => d.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { table, departments, duplicates };
}

export async function addDepartment(name) {
  const label = normalizeName(name);
  if (!label) throw new Error('Department name required');
  const { table, departments } = await loadDepartments();
  const existing = departments.find((d) => d.name.toLowerCase() === label.toLowerCase());
  if (existing) return { table, department: existing, created: false };
  const res = await api.masterDataRowInsert(table.id, { [DEPARTMENTS_COLUMN]: label });
  return {
    table: res.table || table,
    department: { id: res.row.id, name: label },
    created: true,
  };
}

export async function removeDepartment(rowId) {
  const { table } = await loadDepartments();
  await api.masterDataRowDelete(table.id, rowId);
  return loadDepartments();
}

/** Ensure a department label exists in the master table (for legacy agent values). */
export async function ensureDepartmentName(name) {
  const label = normalizeName(name);
  if (!label) return null;
  const res = await addDepartment(label);
  return res.department;
}
