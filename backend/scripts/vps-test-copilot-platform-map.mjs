/** Public HTTPS acceptance with exact synthetic fixtures; no existing profile edits. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync,readFileSync,existsSync,unlinkSync} from 'node:fs';
if(process.env.COPILOT_VPS_ACCEPTANCE!=='1')throw new Error('COPILOT_VPS_ACCEPTANCE=1 required');
const {getDb}=await import('../src/db/schema.js');const {createSession}=await import('../src/services/auth/session.js');
const db=getDb(),uiFile='/tmp/copilot-map-ui-acceptance.json',base='https://login.flolah.cloud';
function cleanup(ids){assert(Array.isArray(ids)&&ids.length===2&&ids.every(id=>/^copilot-map-acceptance-[ab]-[0-9a-f-]+$/.test(id)),'Only exact synthetic fixture users may be removed');db.transaction(()=>{for(const id of ids){
 // A service restart can seed defaults for fixture users; remove children first.
 for(const [table,field] of [['ui_copilot_sessions','owner'],['ui_copilot_recipes','owner'],['efficiency_preferences','owner_user_id'],['efficiency_calls','owner_user_id'],['token_usage','owner_user_id'],['model_route_events','owner_user_id'],['master_data_rows','owner_user_id'],['master_data_tables','owner_user_id'],['ceo_org_strategy','owner_user_id'],['promotion_events','user_id'],['user_agents','user_id'],['platform_sessions','user_id']])if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))db.prepare(`DELETE FROM ${table} WHERE ${field}=?`).run(id);
 db.prepare('DELETE FROM platform_users WHERE id=?').run(id);
}})();}
if(process.argv.includes('--cleanup-ui')){
 const config=JSON.parse(readFileSync(uiFile));assert(config.users.every(id=>/^copilot-map-acceptance-[ab]-[0-9a-f-]+$/.test(id)));cleanup(config.users);unlinkSync(uiFile);db.close();console.log('Exact UI acceptance users/sessions removed.');process.exit(0);
}
const keep=process.argv.includes('--prepare-ui');if(keep&&existsSync(uiFile))throw new Error('Existing UI fixture must be cleaned up first');
const suffix=randomUUID(),users=['a','b'].map(k=>`copilot-map-acceptance-${k}-${suffix}`),tokens={};let checks=0;
const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++};
async function call(path,who=users[0],method='GET',body){const r=await fetch(base+'/api/ui-copilot'+path,{method,signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json',...(who?{authorization:`Bearer ${tokens[who]}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json()};}
let passed=false;
try{
 for(const id of users){db.prepare("INSERT INTO platform_users(id,email,password_hash,name,role,enabled,llm_efficiency_mode) VALUES (?,?,'no-login-fixture','Copilot synthetic fixture','ceo',1,1)").run(id,id+'@fixture.invalid');tokens[id]=createSession(id).token;}
 check((await call('/platform-map',null)).status,401,'unauthenticated map rejected');
 const map=await call('/platform-map');check(map.status,200,'public map endpoint');check(map.data.indexed,true,'source map persisted in index');
 assert(map.data.counts.seeded_recipes>0);checks++;
 check(map.data.nodes.some(n=>n.route.startsWith('/admin')),false,'CEO map excludes Admin routes');
 const recipes=await call('/coaching');check(recipes.status,200,'public recipe catalog');
 assert(recipes.data.seeded_recipes.length>0);checks++;
 const first=recipes.data.seeded_recipes[0];check(first.source,'platform_seed','source-managed recipe immediately available');
 check((await call('/coaching/'+first.id,users[1])).status,200,'authorized source recipes available to another company');
 check((await call('/coaching/'+first.id,users[0],'PUT',{version:first.version,status:'archived'})).status,403,'tenant cannot edit global seed');
 const privateLesson=await call('/coaching',users[0],'POST',{title:'PRIVATE-FIXTURE-LESSON'});check(privateLesson.status,200,'private lesson creation preserved');
 check((await call('/coaching/'+privateLesson.data.id,users[1])).status,404,'other company cannot read private lesson');
 check((await call('/coaching/'+privateLesson.data.id+'/suggestion',users[1])).status,404,'other company cannot suggest private metadata');
 const recipeMetadata={purpose:'Review efficiency mode preference',use_when:'Explain efficiency mode preference without changing settings',not_for:'Changing profile settings',examples:'Explain efficiency mode preference',prerequisites:'An authorized profile screen',expected_outcome:'Efficiency mode preference is understood; no fields are changed'};
 let lesson=(await call('/coaching/'+privateLesson.data.id,users[0],'PUT',{version:privateLesson.data.version,metadata:recipeMetadata})).data;
 check(lesson.metadata,recipeMetadata,'purpose metadata round-trips over public HTTPS');
 check((await call('/coaching/'+lesson.id,users[0],'PUT',{version:privateLesson.data.version,metadata:recipeMetadata})).status,409,'stale metadata edits rejected');
 for(const [screen,path] of [['profile','/profile'],['content-explorer','/content-explorer']]){
  lesson=(await call('/coaching/'+lesson.id,users[0],'PUT',{version:lesson.version,step:{screen,path,action:'navigate',instruction:screen==='profile'?'Inspect efficiency mode preference without editing.':'Return to Content Explorer.',success:'The authorized screen is visible; settings remain unchanged.',fields:[]}})).data;
 }
 lesson=(await call('/coaching/'+lesson.id,users[0],'PUT',{version:lesson.version,status:'published',reviewed:true})).data;
 check(lesson.status,'published','metadata reviewed and published with complete journey');
 const suggestion=await call('/coaching/'+lesson.id+'/suggestion');check(suggestion.data.review_required,true,'suggestion explicitly requires review');
 check((await call('/coaching/'+lesson.id)).data.version,lesson.version,'suggestion did not save');
 const {copilotCoachingStore}=await import('../src/services/ui-copilot-coaching.js');
 const authorized=(await call('/catalog')).data;
 const ranked=copilotCoachingStore(db).select(users[0],users[0],{message:'Explain efficiency mode preference',screen:'content-explorer',screens:authorized.screens});
 check(ranked.status,'matched','deployed ranking matched by purpose');check(ranked.hints[0].steps.length,2,'full cross-screen journey reaches model context');
 if(process.env.COPILOT_RECIPE_LIVE_MODEL==='1'){
  const live=(await call('/session',users[0],'POST',{origin:'/content-explorer'})).data;
  const result=await call('/session/'+live.id+'/propose',users[0],'POST',{version:live.version,screen:'content-explorer',message:'Explain efficiency mode preference. Do not navigate, fill or save.'});
  check(result.status,200,'live deployed model returns valid response with recipe context');
  check(result.data.conversation.at(-1).recipe_match.status,'matched','live response attributes recording');
  check(result.data.proposal.actions,[],'guidance-only request prepares no writes or navigation');
 }
 const bad=await call('/coaching/'+lesson.id,users[0],'PUT',{version:lesson.version,metadata:{...recipeMetadata,purpose:'password=never-record'}});check(bad.status,400,'metadata credentials rejected');
 lesson=(await call('/coaching/'+lesson.id,users[0],'PUT',{version:lesson.version,metadata:{...recipeMetadata,purpose:'Review current efficiency mode preference'}})).data;
 check(lesson.status,'draft','metadata edit invalidates automatic guidance');
 check(copilotCoachingStore(db).select(users[0],users[0],{message:'Explain efficiency mode preference',screens:authorized.screens}).status,'none','new draft hides earlier publication');
 const session=await call('/session',users[0],'POST',{origin:'/profile'});check(session.status,200,'synthetic session creation');
 check((await call('/session/'+session.data.id,users[1],'PUT',{version:session.data.version,status:'paused'})).status,404,'cross-company copilot session denied');
 check(db.prepare('SELECT count(*) n FROM ui_copilot_platform_documents WHERE metadata_json LIKE ?').get('%PRIVATE-FIXTURE-LESSON%').n,0,'private lessons never enter shared source index');
 console.log(JSON.stringify({stage:'COPILOT_PUBLIC_MAP_ACCEPTANCE_PASS',checks,revision:map.data.revision,authorized_counts:map.data.counts,source_documents:db.prepare('SELECT count(*) n FROM ui_copilot_platform_documents').get().n}));
 if(keep){
  // A real first-login company gate can redirect the new synthetic CEO after
  // the page first renders. Use the supported skip API for this fixture only.
  const gate=await fetch(base+'/api/company-setup/skip',{method:'POST',signal:AbortSignal.timeout(30000),headers:{'content-type':'application/json',authorization:'Bearer '+tokens[users[0]]},body:'{}'});
  assert.equal(gate.status,200);assert.equal((await gate.json()).needs_gate,false);
  writeFileSync(uiFile,JSON.stringify({origin:base,token:tokens[users[0]],users}),{mode:0o600});console.log('Private UI fixture prepared at '+uiFile+' with onboarding gate resolved; token not logged.');
 }
 passed=true;
}finally{if(!keep||!passed)cleanup(users);db.close();}
