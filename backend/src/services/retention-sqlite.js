import { setImmediate as yieldTurn } from 'node:timers/promises';
import { retentionRules, retentionChildren, retentionRedactions } from './retention-policy-registry.js';
import {retentionCoverage} from './retention-coverage.js';

const quote = value => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw Error('Invalid retention identifier');
  return `"${value}"`;
};
const columns = (db, table) => new Set(db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c => c.name));

/** Bounded transactions: release SQLite's write lock and the event loop every batch. */
export async function purgeSqliteHistory(db, owner, {
  cutoffMs, userIds = [owner], tenantOwner = null, dryRun = false, batchSize = 200,
  maxBatches = 100, rules = retentionRules, children = retentionChildren,
  redactions = retentionRedactions,
} = {}) {
  if (!owner || !Number.isFinite(cutoffMs) || cutoffMs >= Date.now()) throw Error('Invalid retention owner/cutoff');
  if (tenantOwner && tenantOwner !== owner) throw Error('Tenant retention owner mismatch');
  batchSize = Math.max(1, Math.min(500, Number(batchSize) || 200));
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name));
  const references=new Map();
  for(const dependent of tables)for(const fk of db.prepare(`PRAGMA foreign_key_list(${quote(dependent)})`).all()){
    if(!references.has(fk.table))references.set(fk.table,[]);
    references.get(fk.table).push({dependent,...fk});
  }
  const result = { deleted: {}, redacted: {}, errors: [], deferred: [], absent: [], dry_run: dryRun };
  result.coverage=retentionCoverage(db);
  result.unclassified=result.coverage.filter(r=>r.mode==='unclassified').map(r=>r.table);
  const cutoff = new Date(cutoffMs).toISOString();
  const whereFor = (table, rule) => {
    const cols = columns(db, table);
    let scope, args = [];
    if(rule.parent && tables.has(rule.parent.table)){
      const p=rule.parent;
      scope=`${quote(p.fk)} IN (SELECT ${quote(p.key)} FROM ${quote(p.table)} WHERE ${quote(p.owner)}=?)`;args.push(owner);
    } else if (cols.has(rule.owner)) {
      const owners = rule.users ? userIds : [owner];
      scope = `${quote(rule.owner)} IN (${owners.map(() => '?').join(',')})`; args.push(...owners);
    } else if (tenantOwner === owner) scope = '1=1';
    else if(!db.prepare(`SELECT 1 FROM ${quote(table)} LIMIT 1`).get())return {sql:'0=1',args:[]};
    else throw Error(`Missing ownership column ${rule.owner}`);
    // Expressions are code-owned contracts, not request inputs. Fail on schema drift.
    for (const col of rule.time.match(/[a-z_]+/g) || []) if (!cols.has(col)) throw Error(`Missing retention time column ${col}`);
    let sql = `${scope} AND ${rule.unit === 'ms' ? rule.time + ' < ?' : `datetime(${rule.time}) < datetime(?)`}`;
    args.push(rule.unit === 'ms' ? cutoffMs : cutoff);
    if (rule.state) {
      if (!cols.has(rule.state)) throw Error(`Missing terminal state column ${rule.state}`);
      sql += ` AND ${quote(rule.state)} IN (${rule.states.map(() => '?').join(',')})`; args.push(...rule.states);
    }
    if (rule.expired) {
      sql += ` AND ${rule.unit === 'ms' ? quote(rule.expired) + ' < ?' : `datetime(${quote(rule.expired)}) < datetime(?)`}`;
      args.push(rule.unit === 'ms' ? Date.now() : new Date().toISOString());
    }
    return { sql, args };
  };
  for (const [table, rule] of Object.entries({ ...rules, ...redactions })) {
    if (!tables.has(table)) { result.absent.push(table); continue; }
    try {
      const { sql, args } = whereFor(table, rule);
      const fields = rule.fields;
      const changed = fields ? Object.keys(fields).map(k => `${quote(k)} IS NOT ?`).join(' OR ') : '';
      const predicate = sql + (changed ? ` AND (${changed})` : '');
      if(fields)args.push(...Object.values(fields));
      if (dryRun) {
        (fields ? result.redacted : result.deleted)[table] = db.prepare(`SELECT count(*) n FROM ${quote(table)} WHERE ${predicate}`).get(...args).n;
        continue;
      }
      let batches = 0, total = 0;
      while (batches++ < maxBatches) {
        // Selection and mutation share a short transaction; concurrent state changes
        // cannot turn a selected terminal row into active work between these steps.
        const count = db.transaction(() => {
          const keys = [...new Set((children[table] || []).map(c => c[2]))];
          const rows = db.prepare(`SELECT rowid AS __retention_rowid${keys.length ? ',' + keys.map(quote).join(',') : ''} FROM ${quote(table)} WHERE ${predicate} LIMIT ?`).all(...args, batchSize);
          if (!rows.length) return 0;
          // Foreign keys may be disabled in legacy stores. Never leave dangling
          // references or cascade into a dependent record outside this contract.
          if(!fields)for(const {dependent,...fk} of references.get(table)||[]){
            if((children[table]||[]).some(c=>c[0]===dependent))continue;
              if(db.prepare(`SELECT 1 FROM ${quote(dependent)} WHERE ${quote(fk.from)} IN (SELECT ${quote(fk.to)} FROM ${quote(table)} WHERE rowid IN (${rows.map(()=>'?').join(',')})) LIMIT 1`).get(...rows.map(r=>r.__retention_rowid)))throw Error(`Retained dependent records in ${dependent}`);
          }
          if (!fields) for (const [child, fk, pk] of children[table] || []) {
            if (!tables.has(child)) continue;
            const childCols = columns(db, child);
            const ownerCol = ['owner_user_id','ceo_user_id','owner_id','owner'].find(c => childCols.has(c));
            // Check rather than delete a child belonging to a different company.
            for (const row of rows) {
              if (ownerCol && db.prepare(`SELECT 1 FROM ${quote(child)} WHERE ${quote(fk)}=? AND ${quote(ownerCol)} IS NOT ? LIMIT 1`).get(row[pk], owner)) throw Error(`Cross-owner child in ${child}`);
              if (childCols.has('status') && db.prepare(`SELECT 1 FROM ${quote(child)} WHERE ${quote(fk)}=? AND lower(status) IN ('pending','queued','running','active','waiting','awaiting_approval') LIMIT 1`).get(row[pk])) throw Error(`Active child in ${child}`);
              db.prepare(`DELETE FROM ${quote(child)} WHERE ${quote(fk)}=?`).run(row[pk]);
            }
          }
          const marks = rows.map(() => '?').join(',');
          const ids = rows.map(r => r.__retention_rowid);
          return fields
            ? db.prepare(`UPDATE ${quote(table)} SET ${Object.keys(fields).map(k => `${quote(k)}=?`).join(',')} WHERE rowid IN (${marks})`).run(...Object.values(fields), ...ids).changes
            : db.prepare(`DELETE FROM ${quote(table)} WHERE rowid IN (${marks})`).run(...ids).changes;
        }).immediate();
        total += count;
        await yieldTurn();
        if (count < batchSize) break;
      }
      (fields ? result.redacted : result.deleted)[table] = total;
      if (batches > maxBatches) result.deferred.push(table);
    } catch (error) { result.errors.push({ table, error: error.message }); }
  }
  result.ok = result.errors.length === 0 && result.deferred.length === 0 && result.unclassified.length===0;
  return result;
}
