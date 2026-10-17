/** Versioned SOURCE metadata only. No tenant records, field values, selectors or credentials. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {COPILOT_FORMS,copilotError} from './ui-copilot-contract.js';
import {copilotScreenTemplate} from './ui-copilot-screen-specs.js';
import {isCopilotFillableField} from './ui-copilot-field-policy.js';
const inventory=JSON.parse(readFileSync(new URL('../generated/copilot-screen-inventory.json',import.meta.url)));
const modules=new Map(inventory.modules.map(m=>[m.source,m]));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const PLATFORM_MAP_REVISION=hash([3,inventory,COPILOT_FORMS]);
const recipeVersion=Number.parseInt(PLATFORM_MAP_REVISION.slice(0,10),16);
const path=route=>String(route||'').split(/[?#]/)[0];
const sources=[];
const add=(id,kind,route,title,metadata)=>sources.push({id,kind,route,title,metadata});
for(const route of inventory.routes){
 const parts=route.modules.map(id=>modules.get(id)).filter(Boolean);
 const controls=parts.flatMap(m=>m.controls),forms=parts.flatMap(m=>m.forms||[]);
 const title=parts.flatMap(m=>m.headings||[])[0]||route.path;
 add('screen:'+route.path,'screen',route.path,title,{route:route.path,sections:parts.flatMap(m=>m.headings||[]),forms,links:parts.flatMap(m=>m.links||[]),field_count:controls.length,acceptance:'source_mapped_not_rendered_verified'});
 for(const control of controls)add('field:'+route.path+':'+control.id,'field',route.path,control.label,{...control,autofill_allowed:isCopilotFillableField(control),validation_authority:'existing_form_and_server',options_authority:'fresh_live_options_required'});
 const recipe=(key,title,fields,extra={})=>add('platform-'+hash([route.path,key]).slice(0,20),'recipe',route.path,title,{fields:fields.filter(isCopilotFillableField).map(f=>f.id),...extra});
 recipe('screen',title+' — inspect and prepare',controls);
 for(const form of forms)recipe(form.id,title+' — '+form.label,controls.filter(c=>c.form_id===form.id),{source_form:form.id,form_label:form.label});
}
for(const [id,form] of Object.entries(COPILOT_FORMS)){
 add('registered:'+id,'registered_form',path(form.route),form.label,{form:id,...form,submission:'manual_user_action'});
 add('platform-registered-'+id,'recipe',path(form.route),form.label+' — prepare and review',{form:id,fields:Object.keys(form.fields),purpose:form.purpose});
}
const byId=new Map(sources.map(r=>[r.id,r]));
const initialized=new WeakSet();

export function ensureCopilotPlatformIndex(db){
 if(initialized.has(db))return;
 db.exec(`CREATE TABLE IF NOT EXISTS ui_copilot_platform_map_state(id TEXT PRIMARY KEY,revision TEXT NOT NULL,indexed_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS ui_copilot_platform_documents(id TEXT PRIMARY KEY,kind TEXT NOT NULL,route TEXT NOT NULL,title TEXT NOT NULL,metadata_json TEXT NOT NULL);
 CREATE VIRTUAL TABLE IF NOT EXISTS ui_copilot_platform_search USING fts5(id UNINDEXED,body);`);
 if(db.prepare("SELECT revision FROM ui_copilot_platform_map_state WHERE id='source'").get()?.revision!==PLATFORM_MAP_REVISION){
  db.transaction(()=>{
   // These dedicated tables contain only generated Flolah source metadata.
   db.prepare('DELETE FROM ui_copilot_platform_documents').run();db.prepare('DELETE FROM ui_copilot_platform_search').run();
   const put=db.prepare('INSERT INTO ui_copilot_platform_documents VALUES (?,?,?,?,?)'),search=db.prepare('INSERT INTO ui_copilot_platform_search VALUES (?,?)');
   for(const record of sources){put.run(record.id,record.kind,record.route,record.title,JSON.stringify(record.metadata));search.run(record.id,record.title+' '+record.route+' '+JSON.stringify(record.metadata));}
   db.prepare("INSERT INTO ui_copilot_platform_map_state VALUES ('source',?,datetime('now')) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,indexed_at=excluded.indexed_at").run(PLATFORM_MAP_REVISION);
  })();
 }
 initialized.add(db);
}

function allowed(catalog){
 return new Set(catalog.screens.map(s=>copilotScreenTemplate(s.route)).filter(Boolean));
}
function entitled(record,catalog,routes=allowed(catalog)){
 if(record.metadata.form)return Object.hasOwn(catalog.forms,record.metadata.form);
 return routes.has(record.route);
}
function bindRecipe(record,catalog,routes=allowed(catalog)){
 if(!record||record.kind!=='recipe'||!entitled(record,catalog,routes))return null;
 const screen=catalog.screens.find(s=>copilotScreenTemplate(s.route)===record.route)||
  (record.metadata.form?catalog.screens.filter(s=>record.route.startsWith(path(s.route)+'/')).sort((a,b)=>b.route.length-a.route.length)[0]:null);
 if(!screen)return null;
 const fields=record.metadata.fields.slice(0,60);
 return {id:record.id,version:recipeVersion,map_revision:PLATFORM_MAP_REVISION,status:'published',source:'platform_seed',readonly:true,
  title:record.metadata.form?record.title:(screen.label||record.title)+' — '+(record.metadata.form_label||'screen guidance'),
  evidence:'source_schema_not_rendered_acceptance',requires_live_inspection:true,
  steps:[
   {screen:screen.id,path:path(screen.route),action:'navigate',fields:[],instruction:'Open the authorized screen and wait for its current controls.',success:'The requested screen is open for this signed-in user.'},
   {screen:screen.id,path:path(screen.route),action:'wait',fields:[],instruction:'Inspect visible controls and current dropdown options. Hidden or unavailable fields are not editable.',success:'Fresh field metadata is available; no values have been changed.'},
   {screen:screen.id,path:path(screen.route),action:'fill',fields,instruction:record.metadata.form?'Use registered form '+record.metadata.form+' for a partial reviewed draft. Ask only for missing requested values.':'Map requested values to the current supported controls and prepare a partial patch for explicit review.',success:'Only requested eligible fields are prepared and approved; existing unrelated fields stay unchanged.'},
   {screen:screen.id,path:path(screen.route),action:'manual_save',fields:[],instruction:'Saving, submission, authorization and protected operations remain separate user actions. Warn if this form auto-saves.',success:'The user explicitly chooses whether to save or submit; do not claim it happened.'},
   {screen:screen.id,path:path(screen.route),action:'verify',fields:[],instruction:'Inspect the resulting screen or reopen the same item to verify the requested outcome. Never retry creation to repair a field.',success:'Report observed evidence, or explicitly state what is still unverified.'},
  ]};
}

export function platformSeedRecipes(db,catalog){
 ensureCopilotPlatformIndex(db);
 const routes=allowed(catalog);return sources.filter(r=>r.kind==='recipe').map(r=>bindRecipe(r,catalog,routes)).filter(Boolean);
}
export function platformSeedRecipe(db,catalog,id){
 ensureCopilotPlatformIndex(db);const recipe=bindRecipe(byId.get(id),catalog);
 if(!recipe)throw copilotError('Recipe not found',404);return recipe;
}

export function copilotPlatformMap(db,catalog){
 ensureCopilotPlatformIndex(db);const routes=allowed(catalog);
 const records=sources.filter(r=>entitled(r,catalog,routes));
 return {revision:PLATFORM_MAP_REVISION,indexed:true,source:'build_source_and_registered_contracts',
  scope:'authorized_screens_only',acceptance:'source_map_not_full_rendered_UAT',
  counts:{screens:routes.size,forms:records.filter(r=>r.kind==='screen').reduce((n,r)=>n+r.metadata.forms.length,0),fields:records.filter(r=>r.kind==='field').length,registered_forms:records.filter(r=>r.kind==='registered_form').length,seeded_recipes:platformSeedRecipes(db,catalog).length},
  nodes:records.filter(r=>r.kind==='screen').map(r=>({route:r.route,title:r.title,...r.metadata})),
  registered_forms:records.filter(r=>r.kind==='registered_form').map(r=>({id:r.metadata.form,...r.metadata})),
  policy:'Source metadata is not execution authority. Live visibility/options, actor permissions, protected fields, validation and explicit review still apply.'};
}

export function copilotPlatformContext(db,catalog,message,activeScreen){
 ensureCopilotPlatformIndex(db);
 const routes=allowed(catalog),terms=[...new Set(String(message).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[])].filter(w=>!['the','this','that','for','and','with','please','update','change','prepare','only','from','have'].includes(w)).slice(0,10);
 const params=[...routes];
 const records=[];
 if(terms.length&&params.length){
  const query=terms.map(t=>'"'+t+'"*').join(' OR ');
  const rows=db.prepare(`SELECT d.id FROM ui_copilot_platform_search f JOIN ui_copilot_platform_documents d ON d.id=f.id WHERE ui_copilot_platform_search MATCH ? AND d.route IN (${params.map(()=>'?').join(',')}) ORDER BY bm25(ui_copilot_platform_search) LIMIT 20`).all(query,...params);
  for(const row of rows){const record=byId.get(row.id);if(record&&entitled(record,catalog,routes))records.push(record);}
 }
 const current=activeScreen?copilotScreenTemplate(activeScreen.route):null;
 const candidates=[...records,...sources.filter(r=>r.kind==='screen'&&r.route===current&&routes.has(current))];
 const selected=[];let budget=9000;
 for(const r of [...new Map(candidates.map(r=>[r.id,r])).values()]){
  const item={kind:r.kind,title:r.title,route:r.route,...r.metadata};const size=JSON.stringify(item).length;
  if(size>budget)continue;selected.push(item);budget-=size;if(selected.length===8)break;
 }
 const recipes=platformSeedRecipes(db,catalog).filter(r=>r.steps.some(s=>s.screen===activeScreen?.id)).slice(0,2);
 return {revision:PLATFORM_MAP_REVISION,evidence:'source_schema_not_live_acceptance',matches:selected,seeded_recipes:recipes.map(r=>({id:r.id,version:r.version,title:r.title,steps:r.steps.map(({screen,action,instruction,success})=>({screen,action,instruction,success}))}))};
}
