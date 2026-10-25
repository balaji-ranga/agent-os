import {ensureFloAssistRuntime,listReminders} from './runtime.js';
import {ensureStorage} from './storage.js';

export function managementView(db,owner){
  ensureFloAssistRuntime(db);ensureStorage(db);
  return {reminders:listReminders(db,owner),notifications:db.prepare('SELECT source_key,status,created_at,updated_at,expires_at FROM floassist_notifications WHERE owner_id=? ORDER BY created_at DESC LIMIT 100').all(owner),storage:db.prepare('SELECT app_id,coverage,used,allocated,percent,checked_at FROM floassist_storage_health WHERE owner_id=?').all(owner)};
}
export function reconcileDelivery(db,owner,{kind,id,action,reason},actor){
  ensureFloAssistRuntime(db);
  if(!['reminder','notification'].includes(kind)||!['cancel','confirm_sent','confirm_not_sent'].includes(action)||typeof reason!=='string'||reason.trim().length<8)
    throw Object.assign(new Error('Choose a delivery and provide the verification evidence (at least 8 characters).'),{status:400});
  db.exec(`CREATE TABLE IF NOT EXISTS floassist_delivery_audit(id INTEGER PRIMARY KEY,owner_id TEXT,kind TEXT,item_id TEXT,action TEXT,reason TEXT,actor_id TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  const table=kind==='reminder'?'floassist_reminders':'floassist_notifications',key=kind==='reminder'?'id':'source_key';
  return db.transaction(()=>{
    const row=db.prepare(`SELECT * FROM ${table} WHERE owner_id=? AND ${key}=?`).get(owner,id);
    const allowed=action==='cancel'?['pending','uncertain']:['uncertain'];
    if(!row||!allowed.includes(row.status))throw Object.assign(new Error('This delivery cannot be changed in its current state.'),{status:409});
    if(action==='confirm_not_sent'&&(!row.text||(row.expires_at&&row.expires_at<=Date.now())))throw Object.assign(new Error('Message expired; create a new request after verifying the old delivery.'),{status:409});
    const status=action==='cancel'?'cancelled':action==='confirm_sent'?'sent':'pending';
    db.prepare(`UPDATE ${table} SET status=?,text=CASE WHEN ?='pending' THEN text ELSE NULL END,updated_at=? WHERE owner_id=? AND ${key}=?`).run(status,status,Date.now(),owner,id);
    db.prepare('INSERT INTO floassist_delivery_audit(owner_id,kind,item_id,action,reason,actor_id) VALUES (?,?,?,?,?,?)').run(owner,kind,id,action,reason.slice(0,1000),actor);
    return {ok:true,status};
  })();
}
