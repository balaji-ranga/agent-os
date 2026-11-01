import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {physicalSchemas} from '../openclaw-extensions/agent-os-content-tools/physical-schemas.js';
for(const entry of ['index.js','index.ts']){
 const code=readFileSync(new URL('../openclaw-extensions/agent-os-content-tools/'+entry,import.meta.url),'utf8');
 assert.ok(code.includes("from './physical-schemas.js'"));assert.ok(code.includes('...physicalSchemas'));
}
assert.deepEqual(physicalSchemas.physical_invoke.required,['entityId','action','input','idempotencyKey']);
assert.equal(physicalSchemas.physical_invoke.properties.input.type,'object');
assert.equal(physicalSchemas.physical_operation_get.properties.operationId.type,'string');
for(const schema of Object.values(physicalSchemas)){
 assert.equal(schema.additionalProperties,false);
 for(const forbidden of ['owner_user_id','agent_id','token','password','approval_token'])assert.ok(!Object.hasOwn(schema.properties,forbidden));
}
assert.ok(!physicalSchemas.physical_approve);
console.log('PHYSICAL_TOOL_SCHEMAS_PASS: both entrypoints register typed discovery/invoke/status envelopes without credentials or approval bypass');
