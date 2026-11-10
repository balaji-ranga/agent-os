// Remove a recoverable error from the active branch, retaining the audit trail.
// Native removeTrailingEntries rewrites the complete historical transcript even
// for one synthetic error. Use native append/leaf controls instead; no raw SQL.
export function pruneRecoveryTail(manager,predicate,options={}) {
 const fallback=()=>manager.removeTrailingEntries(predicate,options);
 if(typeof manager.appendLeafControl!=='function'||typeof manager.getLeafEntry!=='function')return fallback();
 const preserved=[],removed=[],seen=new Set();let entry=manager.getLeafEntry();
 while(entry&&options.preserveTrailing?.(entry)){
  if(seen.has(entry.id))return fallback();seen.add(entry.id);
  if(!['custom','label','session_info','message'].includes(entry.type))return fallback();
  preserved.push(entry);entry=entry.parentId?manager.getEntry(entry.parentId):null;
 }
 while(entry&&predicate(entry)){
  if(seen.has(entry.id))return fallback();seen.add(entry.id);removed.push(entry);
  const parent=entry.parentId;entry=parent?manager.getEntry(parent):null;
  if(parent&&!entry)return fallback();
 }
 if(!removed.length)return 0;
 const removedIds=new Set(removed.map(e=>e.id));
 // Resolve all replay targets before mutating the durable leaf.
 for(const e of preserved)if(e.type==='label'&&!removedIds.has(e.targetId)&&!manager.getEntry(e.targetId))return fallback();
 const retained=entry?.id??null,remapped=new Map();
 manager.appendLeafControl({targetId:retained,appendParentId:retained});
 for(const e of preserved.reverse()){
  let id;
  if(e.type==='custom')id=manager.appendCustomEntry(e.customType,e.data);
  else if(e.type==='session_info')id=manager.appendSessionInfo(e.name||'');
  else if(e.type==='message')id=manager.appendMessage(e.message);
  else if(!removedIds.has(e.targetId))id=manager.appendLabelChange(remapped.get(e.targetId)||e.targetId,e.label);
  if(id)remapped.set(e.id,id);
 }
 return removed.length;
}
