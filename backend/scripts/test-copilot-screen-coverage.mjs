import assert from 'node:assert/strict';
import {isCopilotFillableField} from '../src/services/ui-copilot-field-policy.js';
for(const label of ['Description','Subscription name'])assert.equal(isCopilotFillableField({id:'safe:1',label,type:'text'}),true);
for(const label of ['Script','JavaScript','Verification code','API token','Permission','Payment'])assert.equal(isCopilotFillableField({id:'safe:1',label,type:'text'}),false);
import {readFileSync} from 'node:fs';
import {validateCopilotProposal,normalizeCopilotScreenActions} from '../src/services/ui-copilot-contract.js';
import {copilotScreenSpec,copilotScreenControls} from '../src/services/ui-copilot-screen-specs.js';
import {withCurrentCopilotScreen} from '../src/services/ui-copilot-current-screen.js';
const inventory=JSON.parse(readFileSync(new URL('../src/generated/copilot-screen-inventory.json',import.meta.url),'utf8'));
const modules=new Map(inventory.modules.map(m=>[m.source,m]));
const routeCatalog={forms:{},agents:[{id:'my-agent'}],screens:[{id:'home',route:'/'},{id:'ai-employees',route:'/workspace'},{id:'objectives',route:'/objectives'},{id:'org',route:'/org'}]};
for(const path of ['/agents/my-agent/chat','/agents/my-agent/workspace','/objectives/test-id']){
  assert.equal(withCurrentCopilotScreen(routeCatalog,path).screens.at(-1).route,path);
  assert.ok(copilotScreenControls(path).length,'Detail route must resolve its registered source controls');
}
for(const path of ['/agents/other-owner/chat','/admin','/login','//evil.test','/objectives/../admin','/company-setup'])assert.equal(withCurrentCopilotScreen(routeCatalog,path),routeCatalog);
assert.equal(withCurrentCopilotScreen(routeCatalog,'/company-setup',{tenantFullAccess:true}).screens.at(-1).route,'/company-setup');
assert.equal(withCurrentCopilotScreen({...routeCatalog,screens:[]},'/agents/my-agent/workspace').screens.length,0);
const connectorSpec=copilotScreenSpec('/connectors',[]);
assert.match(connectorSpec.guidance,/OpenConnector tab/);
assert.ok(connectorSpec.modules.every(m=>m.fields.length===0),'Hidden tab fields must not enter current-screen model context');
assert.ok(copilotScreenSpec('/connectors').modules.some(m=>m.fields.length),'Full registered metadata remains available');
const search=copilotScreenControls('/content-tools').find(c=>c.label==='Search tools registry');
const provider=copilotScreenControls('/connectors').find(c=>c.label==='Event provider');
const subscription=copilotScreenControls('/connectors').find(c=>c.label==='Subscription name');
assert.equal(validateCopilotProposal({message:'Review',actions:[{type:'screen_fill',screen:'connectors',values:{[subscription.id]:'Synthetic subscription'}}]},{forms:{},agents:[],screens:[{id:'connectors',route:'/connectors'}]}).actions[0].values[subscription.id],'Synthetic subscription','Subscription is not executable script');
const choiceSpec=copilotScreenSpec('/connectors',[provider.id],{[provider.id]:[{value:'ics',label:'Published calendar'},{value:4,label:'Invalid'}]});
const choiceField=choiceSpec.modules.flatMap(m=>m.fields).find(f=>f.id===provider.id);
assert.equal(choiceField.autofill_allowed,true);
assert.deepEqual(choiceField.allowed_options,[{value:'ics',label:'Published calendar'}]);
assert.ok(copilotScreenSpec('/connectors').modules.flatMap(m=>m.fields).filter(f=>f.type==='checkbox').every(f=>f.autofill_allowed===false));
const searchCatalog={forms:{},agents:[],screens:[{id:'content-tools',route:'/content-tools'}]};
const shorthand={message:'Review',actions:[{type:'fill',form:'content-tools',values:{[search.id]:'crm'}}]};
assert.equal(validateCopilotProposal(normalizeCopilotScreenActions(shorthand,searchCatalog,'content-tools',[search.id]),searchCatalog).actions[0].type,'screen_fill');
assert.throws(()=>validateCopilotProposal(normalizeCopilotScreenActions(shorthand,searchCatalog,'other-screen',[search.id]),searchCatalog));
assert.throws(()=>validateCopilotProposal(normalizeCopilotScreenActions(shorthand,searchCatalog,'content-tools',[]),searchCatalog));
assert.equal(validateCopilotProposal({message:'Review search',actions:[{type:'screen_fill',screen:'content-tools',values:{[search.id]:'crm'}}]}, {forms:{},agents:[],screens:[{id:'content-tools',route:'/content-tools'}]}).actions[0].values[search.id],'crm');
let accepted=0,denied=0;
for(const module of inventory.modules)assert.equal(new Set(module.controls.map(c=>c.id)).size,module.controls.length,'Every source control must have a unique identity: '+module.source);
for(const route of inventory.routes){
 const catalog={forms:{},agents:[],screens:[{id:'test-screen',route:route.path}]};
 for(const field of copilotScreenSpec(route.path).modules?.flatMap(m=>m.fields)||[]){
   const proposal={message:'Review',actions:[{type:'screen_fill',screen:'test-screen',values:{[field.id]:'synthetic'}}]};
   if(field.autofill_allowed)validateCopilotProposal(proposal,catalog);
   else assert.throws(()=>validateCopilotProposal(proposal,catalog),'Metadata must match execution policy: '+field.id);
 }
 for(const control of route.modules.flatMap(m=>modules.get(m).controls)){
  const input={message:'Guide',actions:[{type:'screen_guide',screen:'test-screen',steps:[{control:control.id,instruction:'Review this field.'}]}]};
  if(control.user_only){assert.throws(()=>validateCopilotProposal(input,catalog));denied++;}
  else{assert.equal(validateCopilotProposal(input,catalog).actions[0].steps[0].control,control.id);accepted++;}
  assert.throws(()=>validateCopilotProposal(input,{...catalog,screens:[]}));
 }
}
for(const screen of ['crm','erp']){
 const spec=copilotScreenSpec(`/${screen}`);
 assert.equal(spec.mode,'hybrid');
 assert.equal(spec.embedded_screen,screen);
 assert.match(spec.guidance,/available_embedded_fields/);
 assert.match(spec.guidance,/embed_fill/);
 assert.doesNotMatch(spec.guidance,/no autofill adapter/);
 const catalog={forms:{},agents:[],screens:[{id:screen,route:`/${screen}`}]};
 assert.equal(validateCopilotProposal({message:'Guide',actions:[{type:'embed_guide',screen,field:'name'}]},catalog).actions[0].field,'name');
 assert.throws(()=>validateCopilotProposal({message:'Guide',actions:[{type:'embed_guide',screen,field:'password'}]},catalog));
}
console.log(`PASS inventory contract coverage: ${inventory.routes.length} route entries; ${accepted} non-sensitive controls; ${denied} user-only controls denied. This is NOT rendered-screen acceptance.`);
