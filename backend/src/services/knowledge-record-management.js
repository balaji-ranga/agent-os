import {knowledgeStore} from './knowledge-store.js';
import {knowledgeSearch} from './knowledge-search.js';
import {assertKnowledgeSourceAccess} from './knowledge-source-adapters.js';

export async function manageKnowledgeRecords(owner,input,{store=knowledgeStore(),search=knowledgeSearch(),assertAccess=assertKnowledgeSourceAccess}={}){
  const {source_id,action,object_ids,confirm}=input||{};
  if(!owner||!['exclude','restore','refresh'].includes(action)||!Array.isArray(object_ids)||!object_ids.length||object_ids.length>100||object_ids.some(id=>typeof id!=='string'||!id.trim()||id.length>2000))throw new Error('Select 1–100 indexed record IDs and a valid action');
  if(action==='exclude'&&confirm!=='INDEX_ONLY')throw new Error('Confirm INDEX_ONLY to remove indexed copies, not original source records');
  const source=store.get(owner,source_id);if(!source)throw Object.assign(new Error('Source not found'),{status:404});
  await assertAccess(owner,source);
  store.beginRecordManagement(owner,source_id);
  const ids=[...new Set(object_ids)];
  // Fail closed: on index errors the source stays paused and the user can retry.
  for(const id of ids)store.setExcluded(owner,source_id,id,action==='exclude');
  if(action==='exclude')await search.deleteIndexedRecords(owner,source,ids);
  if(source.enabled)store.setEnabled(owner,source_id,true);
  const job=source.enabled?store.enqueue(owner,source_id,'lifecycle'):null;
  return {action,processed:ids.length,originals_unchanged:true,source_paused:!source.enabled,job_id:job?.id||null};
}
