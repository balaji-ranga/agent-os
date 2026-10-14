import { randomUUID } from 'node:crypto';
import { copilotError } from './ui-copilot-contract.js';
import { embeddedFieldAllowed, embeddedPathAllowed } from './ui-copilot-embedded-policy.js';

const fail=message=>{throw copilotError(message);};
function text(value,max=240){
  if(typeof value!=='string'||!value.trim()||value.length>max)fail('Provide a short description, not field values or credentials.');
  if(/sk-[\w-]{16,}|Bearer\s+\S+|-----BEGIN|(?:password|api[_ -]?key|access[_ -]?token)\s*[=:]/i.test(value))fail('Credentials cannot be recorded in coaching.');
  return value.trim();
}
export function coachingPath(screen,path){
  if(['crm','erp'].includes(screen)&&!embeddedPathAllowed(screen,path))fail('Unsupported embedded screen path');
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//')||/[\\?#]/.test(path.split('?')[0].split('#')[0]))fail('Invalid screen path');
  // Record identifiers and query strings are not part of a reusable recipe.
  return path.split(/[?#]/)[0].replace(/(\/object\/[^/]+\/)[^/]+/,'$1:record').replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/gi,':id');
}
export function cleanCoachingStep(raw,screens){
  const screen=screens.find(s=>s.id===raw?.screen);
  if(!screen)throw copilotError('Screen access denied',403);
  if(!['crm','erp'].includes(screen.id)&&raw.path!==screen.route)fail('Screen path does not match authorized catalog');
  if(!['navigate','open_form','fill','wait','verify','manual_save'].includes(raw.action))fail('Unknown demonstration action');
  const fields=[...new Set((Array.isArray(raw.fields)?raw.fields:[]).filter(k=>typeof k==='string'&&/^[A-Za-z][A-Za-z0-9_./: -]{0,159}$/.test(k)&&embeddedFieldAllowed(k.toLowerCase().replaceAll(':','.').replaceAll('/','.'))))].slice(0,60);
  return {screen:screen.id,path:coachingPath(screen.id,raw.path),action:raw.action,
    instruction:text(raw.instruction),success:text(raw.success),fields,
    observed_at:Date.now(),evidence:'operator_captured_metadata',requires_live_inspection:true};
}

// Private, actor-scoped guidance. Publishing never grants execution permissions.
// Immutable versions retain review provenance; a later edit returns to draft.
export function copilotCoachingStore(db){
  db.exec(`CREATE TABLE IF NOT EXISTS ui_copilot_recipes (
    id TEXT NOT NULL,owner TEXT NOT NULL,actor TEXT NOT NULL,version INTEGER NOT NULL,
    status TEXT NOT NULL,data TEXT NOT NULL,updated_at INTEGER NOT NULL,
    PRIMARY KEY(id,version));
    CREATE INDEX IF NOT EXISTS copilot_recipe_scope ON ui_copilot_recipes(owner,actor,updated_at);`);
  const decode=row=>row&&({id:row.id,version:row.version,status:row.status,updated_at:row.updated_at,...JSON.parse(row.data)});
  const store={
    get(owner,actor,id){const r=db.prepare('SELECT * FROM ui_copilot_recipes WHERE owner=? AND actor=? AND id=? ORDER BY version DESC LIMIT 1').get(owner,actor,id);if(!r)throw copilotError('Recipe not found',404);return decode(r);},
    list(owner,actor,offset=0){return db.prepare(`SELECT r.* FROM ui_copilot_recipes r WHERE owner=? AND actor=? AND version=(SELECT MAX(version) FROM ui_copilot_recipes WHERE id=r.id) ORDER BY updated_at DESC LIMIT 21 OFFSET ?`).all(owner,actor,offset).map(decode);},
    map(owner,actor,screens){
      const rows=db.prepare(`SELECT r.* FROM ui_copilot_recipes r WHERE owner=? AND actor=? AND status='published' AND version=(SELECT MAX(version) FROM ui_copilot_recipes WHERE id=r.id) ORDER BY updated_at DESC LIMIT 101`).all(owner,actor);
      const nodes=new Map(),edges=[];
      for(const r of rows.slice(0,100).map(decode).filter(r=>r.steps.every(s=>screens.some(x=>x.id===s.screen)))){
        let previous=null;
        for(const step of r.steps){const id=step.screen+':'+step.path;
          const n=nodes.get(id)||{id,screen:step.screen,path:step.path,fields:[],checks:[]};
          n.fields=[...new Set([...n.fields,...step.fields])].slice(0,100);n.checks=[...new Set([...n.checks,step.success])].slice(0,12);nodes.set(id,n);
          if(previous&&previous!==id)edges.push({from:previous,to:id,recipe:r.id,version:r.version,action:step.action});previous=id;
        }
      }return {nodes:[...nodes.values()],edges,truncated:rows.length>100,evidence:'operator_reviewed_guidance_not_live_verification'};
    },
    create(owner,actor,title){const id=randomUUID();db.prepare('INSERT INTO ui_copilot_recipes VALUES (?,?,?,1,?,?,?)').run(id,owner,actor,'draft',JSON.stringify({title:text(title,100),steps:[]}),Date.now());return store.get(owner,actor,id);},
    revise(owner,actor,id,version,change){return db.transaction(()=>{
      const old=store.get(owner,actor,id);if(old.version!==version)throw copilotError('Recipe changed. Reload before continuing.',409);
      if(old.status==='archived')throw copilotError('Archived recipes cannot be edited',409);
      const steps=change.step?[...old.steps,change.step]:change.remove_last?old.steps.slice(0,-1):old.steps;
      if(steps.length>24)fail('Limit each recipe to 24 steps');
      const status=change.status||'draft';
      if(!['draft','published','archived'].includes(status))fail('Invalid recipe status');
      if(status==='published'&&(!steps.length||change.reviewed!==true))fail('Review every captured step before publishing');
      db.prepare('INSERT INTO ui_copilot_recipes VALUES (?,?,?,?,?,?,?)').run(id,owner,actor,old.version+1,status,JSON.stringify({title:old.title,steps,reviewed_at:status==='published'?Date.now():null}),Date.now());
      return store.get(owner,actor,id);
    })();},
    hints(owner,actor,screen){
      const candidates=db.prepare(`SELECT r.* FROM ui_copilot_recipes r WHERE owner=? AND actor=? AND status='published' AND version=(SELECT MAX(version) FROM ui_copilot_recipes WHERE id=r.id) ORDER BY updated_at DESC LIMIT 20`).all(owner,actor).map(decode).filter(r=>r.steps.some(s=>s.screen===screen));
      const hints=[];let budget=8000;
      for(const r of candidates){
        const hint={id:r.id,version:r.version,title:r.title,steps:r.steps.filter(s=>s.screen===screen).slice(0,6).map(s=>({...s,fields:s.fields.slice(0,8)}))};
        const size=JSON.stringify(hint).length;if(size>budget)continue;
        hints.push(hint);budget-=size;if(hints.length===3)break;
      }return hints;
    }
  };return store;
}
