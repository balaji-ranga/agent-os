export function migrateProfileRefreshEnvironments(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ibkrnew_profile_refresh_state'").get();
  if (!/CHECK\s*\(\s*environment\s*=\s*'paper'\s*\)/i.test(row?.sql || '')) return;
  db.transaction(() => {
    db.exec(`ALTER TABLE ibkrnew_profile_refresh_state RENAME TO ibkrnew_profile_refresh_state_legacy_paper;
      CREATE TABLE ibkrnew_profile_refresh_state (
        owner_user_id TEXT NOT NULL, bridge_id TEXT NOT NULL, environment TEXT NOT NULL CHECK(environment IN ('paper','live')),
        symbol TEXT NOT NULL, family TEXT NOT NULL CHECK(family IN ('fundamentals','earnings')), provider TEXT NOT NULL,
        status TEXT NOT NULL, reason_code TEXT, refreshed_at TEXT, next_attempt_at TEXT NOT NULL, updated_at TEXT NOT NULL, adapter_version TEXT,
        PRIMARY KEY(owner_user_id,environment,symbol,family,provider));
      INSERT INTO ibkrnew_profile_refresh_state SELECT owner_user_id,bridge_id,environment,symbol,family,provider,status,reason_code,refreshed_at,next_attempt_at,updated_at,adapter_version FROM ibkrnew_profile_refresh_state_legacy_paper;
      DROP TABLE ibkrnew_profile_refresh_state_legacy_paper;`);
  })();
}
