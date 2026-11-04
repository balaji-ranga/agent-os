/**
 * Per-CEO data retention: permanently delete aged chat, standup chat, workflow runs,
 * and CEO Content Explorer media (inbound uploads + generated files on disk).
 */
import { getDb } from '../db/schema.js';
import { getDbForCeo } from '../db/request-db.js';
import { purgeAgedContentExplorerMedia } from './content-explorer.js';
import { listDocuments, deleteDocument, isOpenSearchConfigured } from './master-data.js';

export const RETENTION_DAY_OPTIONS = [30, 60, 90, 120, 365];
export const DEFAULT_RETENTION_DAYS = 90;

export function normalizeRetentionDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  if (RETENTION_DAY_OPTIONS.includes(n)) return n;
  let best = DEFAULT_RETENTION_DAYS;
  let bestDist = Infinity;
  for (const opt of RETENTION_DAY_OPTIONS) {
    const d = Math.abs(opt - n);
    if (d < bestDist) {
      best = opt;
      bestDist = d;
    }
  }
  return best;
}

/** Company policy is the only age source for shared and tenant SQLite history. */
export async function purgeOwnerRetention(ownerUserId, { days = null, dryRun = false } = {}) {
  const owner = String(ownerUserId || '').trim();
  if (!owner) throw new Error('owner_user_id required');
  const db = getDb();
  const row = db.prepare('SELECT data_retention_days,role FROM platform_users WHERE id=?').get(owner);
  if (!row || row.role !== 'ceo') throw Object.assign(new Error('CEO owner profile required for company retention'), { status: 403 });
  const retentionDays = normalizeRetentionDays(days ?? row.data_retention_days ?? DEFAULT_RETENTION_DAYS);
  const cutoffMs = Date.now() - retentionDays * 86400000;
  const { purgeSqliteHistory } = await import('./retention-sqlite.js');
  const users = db.prepare('SELECT id FROM platform_users WHERE id=? OR owner_user_id=?').all(owner,owner).map(r=>r.id);
  const stores = { platform: await purgeSqliteHistory(db,owner,{cutoffMs,userIds:users,dryRun}) };
  const tenant = getDbForCeo(owner);
  if (tenant !== db) stores.tenant = await purgeSqliteHistory(tenant,owner,{cutoffMs,userIds:users,tenantOwner:owner,dryRun});
  const deleted = {}, errors = [];
  for (const [store,result] of Object.entries(stores)) {
    for (const [table,count] of Object.entries(result.deleted)) deleted[table]=(deleted[table]||0)+count;
    errors.push(...result.errors.map(e=>({store,...e})),...result.deferred.map(table=>({store,table,error:'Batch budget reached; continuation required'})));
    errors.push(...result.unclassified.map(table=>({store,table,error:'Missing retention classification; preserved pending review'})));
  }
  // Keep public response names used by the existing UI.
  deleted.agent_voice_sessions=deleted.ceo_voice_sessions||0;
  deleted.workflow_runs=deleted.agent_workflow_runs||0;
  deleted.opensearch_documents=0;
  if (!dryRun) {
    if (isOpenSearchConfigured()) {
      try {
        const docs=[];
        for(let offset=0;;) {
          const page=await listDocuments(owner,{limit:200,offset}); docs.push(...(page.documents||[]));
          if(!page.has_more||!page.documents?.length)break; offset+=page.documents.length;
        }
        for(const doc of docs) {
          const at=Date.parse(doc.created_at||doc.updated_at||'');
          if(Number.isFinite(at)&&at<cutoffMs&&!doc.is_protected){await deleteDocument(owner,doc.id);deleted.opensearch_documents++;}
        }
      } catch(error) { errors.push({store:'opensearch',error:error.message}); }
    }
    try { Object.assign(deleted,purgeAgedContentExplorerMedia(owner,retentionDays)); }
    catch(error){errors.push({store:'media',error:error.message});}
    if(process.env.FLOLAH_PHYSICAL_ENABLED==='1') {
      try {
        const {getPhysicalControlPlane}=await import('./physical/runtime.js');
        stores.physical=getPhysicalControlPlane().purgeHistory(owner,cutoffMs);
      } catch(error){errors.push({store:'physical',error:error.message});}
    }
  }
  const result={ok:errors.length===0,owner_user_id:owner,retention_days:retentionDays,cutoff:new Date(cutoffMs).toISOString(),dry_run:dryRun,deleted,stores,errors};
  if(!dryRun){
    const {enqueueNativeRetention}=await import('./native-retention-queue.js');
    result.native=enqueueNativeRetention(owner,cutoffMs);
    db.exec(`CREATE TABLE IF NOT EXISTS data_retention_runs(id INTEGER PRIMARY KEY,owner_user_id TEXT NOT NULL,finished_at TEXT NOT NULL,result_json TEXT NOT NULL)`);
    db.prepare('INSERT INTO data_retention_runs(owner_user_id,finished_at,result_json) VALUES(?,?,?)').run(owner,new Date().toISOString(),JSON.stringify(result));
  }
  return result;
}

export async function purgeRetentionForAllCeos() {
  const results=[];
  for(const ceo of getDb().prepare("SELECT id FROM platform_users WHERE role='ceo'").all()) {
    try { results.push(await purgeOwnerRetention(ceo.id)); }
    catch(error){results.push({ok:false,owner_user_id:ceo.id,error:error.message});}
  }
  const result={ok:results.every(r=>r.ok),count:results.length,results};
  if(!result.ok)throw Object.assign(new Error('Company retention incomplete; inspect data_retention_runs'),{result});
  return result;
}
