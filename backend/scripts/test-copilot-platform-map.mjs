import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {COPILOT_FORMS} from '../src/services/ui-copilot-contract.js';
import {PLATFORM_MAP_REVISION,ensureCopilotPlatformIndex,copilotPlatformMap,copilotPlatformContext,platformSeedRecipes,platformSeedRecipe} from '../src/services/ui-copilot-platform-map.js';
import {copilotScreenControls} from '../src/services/ui-copilot-screen-specs.js';
const db=new Database(':memory:');let checks=0;
const check=(a,b,m)=>{assert.deepEqual(a,b,m);checks++};
const inventory=JSON.parse(readFileSync(new URL('../src/generated/copilot-screen-inventory.json',import.meta.url)));
const profile={forms:{user_profile:COPILOT_FORMS.user_profile},screens:[{id:'profile',label:'Profile',route:'/profile'}],agents:[]};
try{
 ensureCopilotPlatformIndex(db);const count=db.prepare('SELECT count(*) n FROM ui_copilot_platform_documents').get().n;
 ensureCopilotPlatformIndex(db);check(db.prepare('SELECT count(*) n FROM ui_copilot_platform_documents').get().n,count,'index seeding idempotent');
 check(db.prepare("SELECT revision FROM ui_copilot_platform_map_state WHERE id='source'").get().revision,PLATFORM_MAP_REVISION,'index content revision stored');
 check(db.prepare("SELECT count(*) n FROM ui_copilot_platform_documents WHERE kind='screen'").get().n,inventory.routes.length,'every mapped route indexed, including input-free pages');
 check(db.prepare("SELECT count(*) n FROM ui_copilot_platform_documents WHERE kind='registered_form'").get().n,Object.keys(COPILOT_FORMS).length,'all authoritative adapters indexed');
 const map=copilotPlatformMap(db,profile);
 check(map.counts.screens,1,'map exposes only authorized routes');check(map.nodes[0].route,'/profile','no Admin screen leakage');
 check(map.registered_forms.length,1,'only entitled registered forms');check(map.acceptance,'source_map_not_full_rendered_UAT','index is not a fabricated acceptance certificate');
 const context=copilotPlatformContext(db,profile,'Update efficiency mode to No. PRIVATE_CANARY_NOT_SOURCE',profile.screens[0]);
 check(context.revision,PLATFORM_MAP_REVISION,'each retrieval has an exact source revision');
 assert(context.matches.some(m=>m.label==='Efficiency mode'||m.title==='Efficiency mode'));checks++;
 check(context.matches.every(m=>m.route==='/profile'),true,'search filtered before returning metadata');
 check(JSON.stringify(context).includes('PRIVATE_CANARY_NOT_SOURCE'),false,'query/customer values not stored or echoed as learned knowledge');
 check(JSON.stringify(db.prepare('SELECT metadata_json FROM ui_copilot_platform_documents').all()).includes('PRIVATE_CANARY_NOT_SOURCE'),false,'global index contains source only');
 const denied=copilotPlatformContext(db,{forms:{},screens:[],agents:[]},'Admin API keys profile password',null);
 check(denied.matches,[],'empty permissions means no indexed evidence');check(denied.seeded_recipes,[],'no seeded-recipe permission bypass');
 const seeded=platformSeedRecipes(db,profile);
 assert(seeded.length>=2);checks++;
 for(const recipe of seeded){
  check(recipe.source,'platform_seed','recipes are source-managed');check(recipe.readonly,true,'cannot edit a global recipe with tenant coaching APIs');
  check(recipe.status,'published','seeded guidance immediately available');check(recipe.map_revision,PLATFORM_MAP_REVISION,'recipes refreshed with source changes');
  check(recipe.steps.every(s=>s.screen==='profile'),true,'recipe steps bound to authorized catalog IDs');
  check(recipe.steps.some(s=>s.action==='manual_save'),true,'save stays a user action');
  check(recipe.requires_live_inspection,true,'never replay blind source selectors');
  assert.throws(()=>platformSeedRecipe(db,{forms:{},screens:[],agents:[]},recipe.id),/not found/);checks++;
 }
 for(const route of inventory.routes){
  const c={forms:{},screens:[{id:'allowed-screen',route:route.path}],agents:[]};
  const r=platformSeedRecipes(db,c);assert(r.some(recipe=>!recipe.steps.some(s=>s.screen!=='allowed-screen')));checks++;
 }
 const efficiency=copilotScreenControls('/profile').find(c=>c.label==='Efficiency mode');
 check(efficiency.source_options,[{value:'no',label:'No'},{value:'yes',label:'Yes'}],'static options available as source meaning, never runtime permission');
 const nativeForms=inventory.modules.flatMap(m=>m.forms||[]);
 check(nativeForms.every(f=>f.submission==='manual_user_action'),true,'native form submits do not become automated actions');
 console.log(`PASS platform map: ${checks} checks; ${inventory.routes.length} source routes, ${nativeForms.length} native forms, ${count} indexed documents. Role-filtered FTS, source-only storage and seeded guidance; not full rendered UAT.`);
}finally{db.close()}
