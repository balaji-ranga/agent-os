import { getDb } from './schema.js';
import { writeOpenClawToolsList } from '../services/content-tools-meta.js';
export function seedPhysicalTools(){
  const tools=[['physical_entities_list','List authorized physical assets and their capabilities.','R0','read'],['physical_operation_get','Read a physical operation by operationId, including verified evidence.','R0','read'],['physical_evidence_get','Retrieve an authorized operation screenshot/snapshot: operationId and optional index (default 0). Returns MIME type, SHA-256, capture time, simulated flag and dataBase64. A simulator snapshot is synthetic; a camera image is contextual evidence.','R0','read'],['physical_invoke','Request a physical action: entityId, action, input, idempotencyKey, optional timeoutMs. Approval may be required; never claim completion without observed evidence.','R2','communicate_external'],['physical_cancel','Request cancellation by operationId where supported.','R2','communicate_external']];
  const db=getDb();
  const columns=db.prepare('PRAGMA table_info(content_tools_meta)').all().map(c=>c.name);
  if(!columns.includes('risk_tier'))db.exec("ALTER TABLE content_tools_meta ADD COLUMN risk_tier TEXT DEFAULT ''");
  if(!columns.includes('action_family'))db.exec("ALTER TABLE content_tools_meta ADD COLUMN action_family TEXT DEFAULT ''");
  const insert=db.prepare("INSERT OR IGNORE INTO content_tools_meta(name,display_name,endpoint,method,purpose,enabled,is_builtin,risk_tier,action_family) VALUES(?,?,?,'POST',?,1,1,?,?)");
  for(const [name,purpose,tier,family]of tools)insert.run(name,name.replaceAll('_',' '),'/api/tools/'+name.replaceAll('_','-'),purpose,tier,family);
  // No static agent names and no automatic grants. Owners choose authorized employees.
  writeOpenClawToolsList();
}
