#!/usr/bin/env node
const Database = require('/opt/agent-os/backend/node_modules/better-sqlite3');
const db = new Database('/data/agent-os/agent-os.db', { readonly: true });
const rows = db
  .prepare(
    `SELECT id, email, name, llm_provider,
      CASE WHEN llm_api_key IS NOT NULL AND length(trim(llm_api_key)) > 0 THEN 1 ELSE 0 END AS llm_api_key_set,
      CASE WHEN llm_api_key IS NOT NULL AND length(trim(llm_api_key)) > 8
        THEN substr(llm_api_key,1,4) || '...' || substr(llm_api_key,-4)
        ELSE '' END AS key_masked
     FROM platform_users
     WHERE lower(coalesce(name,'')) LIKE '%balaji%'
        OR lower(coalesce(email,'')) LIKE '%balaji%'
        OR lower(coalesce(name,'')) LIKE '%ranganathan%'
        OR id LIKE '%bala%'`
  )
  .all();
console.log(JSON.stringify(rows, null, 2));
const settings = db
  .prepare(`SELECT key, value, updated_at FROM platform_settings WHERE key = 'llm_active_endpoint'`)
  .all();
console.log('settings', JSON.stringify(settings, null, 2));
