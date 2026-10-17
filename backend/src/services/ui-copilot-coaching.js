import { randomUUID } from 'node:crypto';
import { copilotError } from './ui-copilot-contract.js';
import { embeddedFieldAllowed, embeddedPathAllowed } from './ui-copilot-embedded-policy.js';

const fail=message=>{throw copilotError(message);};
function text(value,max=240){
  if(typeof value!=='string'||!value.trim()||value.length>max)fail('Provide a short description, not field values or credentials.');
  if(/sk-[\w-]{16,}|Bearer\s+\S+|-----BEGIN|(?:password|api[_ -]?key|access[_ -]?token)\s*[=:]/i.test(value))fail('Credentials cannot be recorded in coaching.');
  return value.trim();
}
const metadataLimits={purpose:600,use_when:600,not_for:400,examples:800,prerequisites:600,expected_outcome:600};
export function cleanCoachingMetadata(raw={}){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Recipe metadata must be an object');
  return Object.fromEntries(Object.entries(metadataLimits).map(([key,max])=>[key,raw[key]===undefined||raw[key]===''?'':text(raw[key],max)]));
}
export function coachingMetadataReady(metadata){return ['purpose','use_when','expected_outcome'].every(key=>typeof metadata?.[key]==='string'&&metadata[key].trim());}
export function suggestCoachingMetadata(recipe){
  // A transparent, extractive draft, not an inferred business purpose. Never
  // persist or publish it without the operator editing/reviewing it first.
  return {purpose:recipe.title.slice(0,600),use_when:'',not_for:'',examples:'',prerequisites:'',expected_outcome:(recipe.steps.at(-1)?.success||'').slice(0,600)};
}
const stopWords=new Set('a an and are as at be by can could do for from help i in is it me my of on or please recipe recording recorded lesson the then this to use want with would you your how update change set make open prepare create task'.split(' '));
function words(value){return [...new Set((String(value||'').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(w=>w.length>1&&!stopWords.has(w)).map(w=>w.length>4&&w.endsWith('s')?w.slice(0,-1):w))];}
function rankRecipe(recipe,query,screen){
  const meta=recipe.metadata;
  if(words(meta.not_for).filter(w=>query.includes(w)).length>=2)return null;
  const primary=new Set(words([recipe.title,meta.purpose,meta.use_when,meta.examples].join(' ')));
  const secondary=new Set(words(recipe.steps.map(s=>s.instruction+' '+s.success).join(' ')));
  const matched=query.filter(w=>primary.has(w)),stepMatches=query.filter(w=>!primary.has(w)&&secondary.has(w));
  const total=matched.length+stepMatches.length,coverage=total/Math.max(1,query.length);
  // Screen proximity only breaks ties. It never makes an irrelevant recipe
  // eligible; generic one-word requests cannot select a business workflow.
  if(total<2||matched.length<1||coverage<0.3)return null;
  const score=matched.length*4+stepMatches.length+coverage*3;
  return {recipe,score,local:recipe.steps.some(s=>s.screen===screen),matched:[...matched,...stepMatches].slice(0,10)};
}
export function selectCoachingRecipes(rows,{message='',screen,screens=[]}={}){
  const query=words(message),allowed=new Set(screens.map(s=>s.id)),ranked=[];
  for(const recipe of rows){
    if(!coachingMetadataReady(recipe.metadata)||!recipe.steps.length||!recipe.steps.every(s=>allowed.has(s.screen)))continue;
    const candidate=rankRecipe(recipe,query,screen);if(!candidate)continue;
    ranked.push(candidate);ranked.sort((a,b)=>b.score-a.score||Number(b.local)-Number(a.local)||b.recipe.updated_at-a.recipe.updated_at||a.recipe.id.localeCompare(b.recipe.id));
    if(ranked.length>3)ranked.pop();
  }
  const summary=r=>({id:r.recipe.id,version:r.recipe.version,title:r.recipe.title,screens:[...new Set(r.recipe.steps.map(s=>s.screen))],reason:`Request terms matched: ${r.matched.join(', ')}${r.local?'; includes the current screen':'; cross-screen guidance'}`});
  if(!ranked.length)return {status:'none',candidates:[],hints:[]};
  const top=ranked[0],ambiguous=ranked.length>1&&ranked[1].score>=top.score*0.9;
  if(ambiguous)return {status:'ambiguous',candidates:ranked.filter(r=>r.score>=top.score*0.9).map(summary),hints:[]};
  // Keep the complete ordered journey, not just current-screen steps. Never
  // truncate a journey silently: return an explicit replay choice if oversized.
  const hint={...summary(top),metadata:top.recipe.metadata,steps:top.recipe.steps.map(s=>({...s,fields:s.fields.slice(0,8)}))};
  if(JSON.stringify(hint).length>12000)return {status:'manual_replay',candidates:[summary(top)],hints:[]};
  return {status:'matched',candidates:[summary(top)],hints:[hint]};
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
  const decode=row=>{if(!row)return row;const data=JSON.parse(row.data);return {id:row.id,version:row.version,status:row.status,updated_at:row.updated_at,...data,metadata:data.metadata||{},metadata_required:!coachingMetadataReady(data.metadata)};};
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
    create(owner,actor,title,metadata={}){const id=randomUUID();db.prepare('INSERT INTO ui_copilot_recipes VALUES (?,?,?,1,?,?,?)').run(id,owner,actor,'draft',JSON.stringify({title:text(title,100),metadata:cleanCoachingMetadata(metadata),steps:[]}),Date.now());return store.get(owner,actor,id);},
    revise(owner,actor,id,version,change){return db.transaction(()=>{
      const old=store.get(owner,actor,id);if(old.version!==version)throw copilotError('Recipe changed. Reload before continuing.',409);
      if(old.status==='archived')throw copilotError('Archived recipes cannot be edited',409);
      const steps=change.step?[...old.steps,change.step]:change.remove_last?old.steps.slice(0,-1):old.steps;
      if(steps.length>24)fail('Limit each recipe to 24 steps');
      const status=change.status||'draft';
      const metadata=change.metadata===undefined?old.metadata:cleanCoachingMetadata(change.metadata);
      if(!['draft','published','archived'].includes(status))fail('Invalid recipe status');
      if(status==='published'&&(!steps.length||change.reviewed!==true))fail('Review every captured step before publishing');
      if(status==='published'&&!coachingMetadataReady(metadata))fail('Add and review the purpose, when to use, and expected outcome before publishing');
      db.prepare('INSERT INTO ui_copilot_recipes VALUES (?,?,?,?,?,?,?)').run(id,owner,actor,old.version+1,status,JSON.stringify({title:old.title,metadata,steps,reviewed_at:status==='published'?Date.now():null}),Date.now());
      return store.get(owner,actor,id);
    })();},
    select(owner,actor,options){
      const rows=db.prepare(`SELECT r.* FROM ui_copilot_recipes r WHERE owner=? AND actor=? AND status='published' AND version=(SELECT MAX(version) FROM ui_copilot_recipes WHERE id=r.id AND owner=r.owner AND actor=r.actor)`).iterate(owner,actor);
      return selectCoachingRecipes((function*(){for(const row of rows)yield decode(row);})(),options);
    },
    hints(owner,actor,screen,message='',screens=[]){return store.select(owner,actor,{screen,message,screens}).hints;}
  };return store;
}
