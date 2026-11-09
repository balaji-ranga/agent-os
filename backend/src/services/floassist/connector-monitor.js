import {getDb} from '../../db/schema.js';
import {checkFloAssistConnectorHealth} from './connector-health.js';
import {CONNECTOR_HEALTH_JOB} from './health-settings.js';
import {isPlatformCronActive} from '../platform-cron-registry.js';

/** Bounded, durable owner leases; no LLM, task creation or healthy notifications. */
export async function tickConnectorMonitor({db=getDb(),now=Date.now(),check=checkFloAssistConnectorHealth,active=()=>isPlatformCronActive(CONNECTOR_HEALTH_JOB)}={}) {
  if(!active()||!db.prepare("SELECT 1 FROM sqlite_master WHERE name='floassist_profiles'").get())return {checked:0};
  db.exec(`CREATE TABLE IF NOT EXISTS floassist_connector_monitor(owner_id TEXT PRIMARY KEY,checked_at INTEGER NOT NULL);`);
  const due=db.prepare(`SELECT p.owner_id FROM floassist_profiles p JOIN platform_users u ON u.id=p.owner_id
    LEFT JOIN floassist_connector_monitor m ON m.owner_id=p.owner_id
    WHERE u.enabled=1 AND p.status IN ('active','paused','stopped')
      AND json_extract(p.preferences_json,'$.connector_health_enabled')=1
      AND COALESCE(m.checked_at,0)<=?-MAX(15,MIN(1440,COALESCE(json_extract(p.preferences_json,'$.connector_health_interval_minutes'),60)))*60000
    ORDER BY COALESCE(m.checked_at,0),p.owner_id LIMIT 10`).all(now);
  let checked=0,failed=0;
  for(const row of due){
    if(!active())break;
    const claimed=db.prepare(`INSERT INTO floassist_connector_monitor VALUES (?,?) ON CONFLICT(owner_id) DO UPDATE SET checked_at=excluded.checked_at
      WHERE floassist_connector_monitor.checked_at<=?-MAX(15,MIN(1440,COALESCE((SELECT json_extract(preferences_json,'$.connector_health_interval_minutes') FROM floassist_profiles WHERE owner_id=?),60)))*60000`).run(row.owner_id,now,now,row.owner_id).changes;
    if(!claimed)continue;
    try{await check(row.owner_id,{db});checked++;}catch{failed++;}
  }
  return {checked,failed};
}
