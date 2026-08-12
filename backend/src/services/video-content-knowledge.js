/**
 * Seed Master Data tables for video_content from the industry pack (golden pack JSON).
 * Owner-scoped only — never cross-tenant.
 */
import { getBlueprint } from './company-blueprints/registry.js';
import { createTable, ensureTableColumns, findTableByName, insertRow, listRows } from './master-data.js';

const TABLE_NAMES = ['video_characters', 'video_storyboards', 'video_jobs', 'brand_voice'];

export function seedVideoContentKnowledgeTables(ownerUserId) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw Object.assign(new Error('owner_user_id required'), { status: 400 });

  const blueprint = getBlueprint('video_content');
  const tables = Array.isArray(blueprint?.knowledge_tables) ? blueprint.knowledge_tables : [];
  const created = [];
  const seeded = [];

  for (const tbl of tables) {
    const name = String(tbl.name || '').trim();
    if (!name || !TABLE_NAMES.includes(name)) continue;
    let table = findTableByName(owner, name);
    if (!table) {
      table = createTable(owner, {
        name,
        description: tbl.description || name,
        columns: Array.isArray(tbl.columns) ? tbl.columns : ['notes'],
      });
      created.push(name);
      console.info('[video-knowledge] created table=%s owner=%s', name, owner);
    } else if (Array.isArray(tbl.columns) && tbl.columns.length && table.id) {
      try {
        ensureTableColumns(owner, table.id, tbl.columns);
      } catch (e) {
        console.warn('[video-knowledge] ensure columns failed', name, e?.message || e);
      }
    }
    const seedRows = Array.isArray(tbl.seed_rows) ? tbl.seed_rows : [];
    if (!seedRows.length) continue;
    let existingCount = 0;
    try {
      const listed = listRows(owner, table.id, { limit: 5 });
      existingCount = (listed?.rows || []).length;
    } catch {
      existingCount = 0;
    }
    if (existingCount) continue;
    for (const row of seedRows) {
      try {
        insertRow(owner, table.id, row);
        seeded.push(name);
      } catch (e) {
        console.warn('[video-knowledge] seed row failed', name, e?.message || e);
      }
    }
  }

  return { ok: true, owner, created, seeded_tables: [...new Set(seeded)] };
}
