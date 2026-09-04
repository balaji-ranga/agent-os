import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const fixture=mkdtempSync(join(tmpdir(),'flolah-catalog-test-'));
process.env.AGENT_OS_DATA_DIR=fixture;
const { catalogPrompt } = await import('../src/services/goal-plan-quality.js');
const catalog={current_executor:{id:'root'},tools:[],workflows:[],humans:[],agents:[
  {id:'manager',capabilities:[{name:'export',purpose:'Export work'}],reportees:[{id:'writer',name:'Writer'}]},
  {id:'writer',capabilities:[{name:'write',purpose:'Write work'}],reportees:[]},
]};
const prompt=JSON.parse(catalogPrompt(catalog));
assert.deepEqual(prompt.agents.map(a=>a.id),['manager']);
assert.equal(prompt.agents[0].reportees[0].id,'writer');
assert.deepEqual(prompt.agents[0].capabilities,['export']);
assert.equal(prompt.capability_definitions.export,'Export work');
console.log('PASS direct-executor catalog, nested reportee context, deduplicated capability definitions');
const {getDb}=await import('../src/db/schema.js');
getDb().close();
rmSync(fixture,{recursive:true,force:true});
