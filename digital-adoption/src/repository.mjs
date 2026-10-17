import { DatabaseSync } from 'node:sqlite';

// Independent database; never open the Flolah application database here.
export function openRepository(path = ':memory:') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS adoption_state (namespace TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(namespace,key))');
  const get = db.prepare('SELECT value FROM adoption_state WHERE namespace=? AND key=?');
  const put = db.prepare('INSERT INTO adoption_state VALUES (?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value');
  const remove = db.prepare('DELETE FROM adoption_state WHERE namespace=? AND key=?');
  const all = db.prepare('SELECT value FROM adoption_state WHERE namespace=?');
  const entries = db.prepare('SELECT key,value FROM adoption_state WHERE namespace=?');
  return {
    map(namespace) {
      if (!/^[a-z_]{1,40}$/.test(namespace)) throw new Error('Invalid namespace');
      return {
        get: key => { const row = get.get(namespace, key); return row ? JSON.parse(row.value) : undefined; },
        set: (key, value) => put.run(namespace, key, JSON.stringify(value)),
        delete: key => remove.run(namespace, key),
        values: () => all.all(namespace).map(r => JSON.parse(r.value)),
        entries: () => entries.all(namespace).map(r => [r.key,JSON.parse(r.value)]),
      };
    },
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const result = fn(); db.exec('COMMIT'); return result; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close(),
  };
}
