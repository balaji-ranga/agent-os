import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateCopilotProposal} from '../src/services/ui-copilot-contract.js';
import {copilotScreenSpec} from '../src/services/ui-copilot-screen-specs.js';
const inventory=JSON.parse(readFileSync(new URL('../src/generated/copilot-screen-inventory.json',import.meta.url),'utf8'));
const modules=new Map(inventory.modules.map(m=>[m.source,m]));
const connectorSpec=copilotScreenSpec('/connectors',[]);
assert.match(connectorSpec.guidance,/OpenConnector tab/);
assert.ok(connectorSpec.modules.every(m=>m.fields.length===0),'Hidden tab fields must not enter current-screen model context');
assert.ok(copilotScreenSpec('/connectors').modules.some(m=>m.fields.length),'Full registered metadata remains available');
let accepted=0,denied=0;
for(const route of inventory.routes){
 const catalog={forms:{},agents:[],screens:[{id:'test-screen',route:route.path}]};
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
