import { api } from '../api';
import { DEPARTMENT_PRESET_ROWS } from '../utils/orgHierarchy.js';

export const DEPARTMENTS_TABLE_NAME = 'departments';
export const DEPARTMENTS_COLUMN = 'name';
export const DEPARTMENTS_PURPOSE_COLUMN = 'purpose';
export const DEPARTMENTS_BUDGET_COLUMN = 'monthly_token_budget';
export const DEPARTMENTS_COLUMNS = [
  DEPARTMENTS_COLUMN,
  DEPARTMENTS_PURPOSE_COLUMN,
  DEPARTMENTS_BUDGET_COLUMN,
];

function normalizeName(name) {
  return String(name || '').trim();
}

function rowName(row) {
  const data = row?.data || {};
  return normalizeName(data.name ?? data.Name ?? data.department ?? data.Department ?? '');
}

/** Monthly token budget as a positive integer, or null when unset/invalid. */
export function parseBudget(value) {
  const raw = String(value ?? '').replace(/[,\s]/g, '');
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function rowPurpose(row) {
  const data = row?.data || {};
  return String(data[DEPARTMENTS_PURPOSE_COLUMN] ?? data.Purpose ?? '').trim();
}

function rowBudget(row) {
  const data = row?.data || {};
  return parseBudget(data[DEPARTMENTS_BUDGET_COLUMN]);
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
      columns: DEPARTMENTS_COLUMNS,
      description: 'Org departments (name, purpose, monthly token budget) for agent onboarding',
    });
    table = created.table;
    await seedPresets(table.id);
    const refreshed = await api.masterDataTableGet(table.id, { limit: 1, offset: 0 });
    table = refreshed.table || table;
  } else if ((table.row_count || 0) === 0) {
    await seedPresets(table.id);
    const refreshed = await api.masterDataTableGet(table.id, { limit: 1, offset: 0 });
    table = refreshed.table || table;
  }
  return { table, duplicates: matches.length > 1 ? matches : [] };
}

async function seedPresets(tableId) {
  for (const preset of DEPARTMENT_PRESET_ROWS) {
    await api.masterDataRowInsert(tableId, {
      [DEPARTMENTS_COLUMN]: preset.name,
      [DEPARTMENTS_PURPOSE_COLUMN]: preset.purpose,
      [DEPARTMENTS_BUDGET_COLUMN]: '',
    });
  }
}

/**
 * @returns {{ table: object, departments: Array<{ id: number, name: string, purpose: string, monthly_token_budget: number|null }>, duplicates: object[] }}
 */
export async function loadDepartments() {
  const { table, duplicates } = await ensureDepartmentsTable();
  const rows = await listAllRows(table.id);
  const departments = rows
    .map((r) => ({
      id: r.id,
      name: rowName(r),
      purpose: rowPurpose(r),
      monthly_token_budget: rowBudget(r),
    }))
    .filter((d) => d.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { table, departments, duplicates };
}

export async function addDepartment(name, { purpose = '', monthlyTokenBudget = null } = {}) {
  const label = normalizeName(name);
  if (!label) throw new Error('Department name required');
  const { table, departments } = await loadDepartments();
  const existing = departments.find((d) => d.name.toLowerCase() === label.toLowerCase());
  if (existing) return { table, department: existing, created: false };
  const budget = parseBudget(monthlyTokenBudget);
  const res = await api.masterDataRowInsert(table.id, {
    [DEPARTMENTS_COLUMN]: label,
    [DEPARTMENTS_PURPOSE_COLUMN]: String(purpose || '').trim(),
    [DEPARTMENTS_BUDGET_COLUMN]: budget == null ? '' : String(budget),
  });
  return {
    table: res.table || table,
    department: {
      id: res.row.id,
      name: label,
      purpose: String(purpose || '').trim(),
      monthly_token_budget: budget,
    },
    created: true,
  };
}

/** Update purpose / monthly token budget of an existing department row. */
export async function updateDepartment(rowId, { name, purpose, monthlyTokenBudget } = {}) {
  const { table } = await loadDepartments();
  const patch = {};
  if (name !== undefined) patch[DEPARTMENTS_COLUMN] = normalizeName(name);
  if (purpose !== undefined) patch[DEPARTMENTS_PURPOSE_COLUMN] = String(purpose || '').trim();
  if (monthlyTokenBudget !== undefined) {
    const budget = parseBudget(monthlyTokenBudget);
    patch[DEPARTMENTS_BUDGET_COLUMN] = budget == null ? '' : String(budget);
  }
  await api.masterDataRowUpdate(table.id, rowId, patch);
  return loadDepartments();
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
