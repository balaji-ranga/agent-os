import assert from 'node:assert/strict';
import {redactRetentionEvent} from '../../openclaw-extensions/agent-os-content-tools/retention-redaction.js';
const event={type:'message',id:'id',parentId:'parent',timestamp:'2020-01-01',message:{role:'assistant',content:[{type:'thinking',thinking:'private'},{type:'toolCall',id:'call',name:'device_action',arguments:{secret:'private'}}],private:'private',stopReason:'toolUse'}};
const redacted=redactRetentionEvent(event);
assert.equal(redacted.id,'id');assert.equal(redacted.parentId,'parent');assert.equal(redacted.message.content[1].id,'call');assert.equal(redacted.message.content[1].name,'device_action');assert.deepEqual(redacted.message.content[1].arguments,{});assert(!JSON.stringify(redacted).includes('private'));
assert.equal(redactRetentionEvent(redacted),null);
for(const role of ['user','toolResult','system']){const r=redactRetentionEvent({type:'message',id:'x',message:{role,toolCallId:'call',content:[{type:'image',data:'private'}],details:{secret:'private'}}});assert.equal(r.message.toolCallId,'call');assert(!JSON.stringify(r).includes('private'));}
assert(!JSON.stringify(redactRetentionEvent({type:'custom',data:{secret:'private'},customType:'tool-meta'})).includes('private'));
assert.equal(redactRetentionEvent({type:'session'}),null);
assert.throws(()=>redactRetentionEvent({type:'unknown'}),/Unsupported/);
console.log('RETENTION_REDACTION_OK: expired payload removal, graph IDs, tool pairing, idempotence, unknown-format refusal');
