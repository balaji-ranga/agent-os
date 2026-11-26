import assert from 'node:assert/strict';
import {structuredCompletionMessages} from '../src/services/structured-completion-contract.js';
const messages=[{role:'system',content:'Resolve the current task'},{role:'user',content:'Retry the replied-to request'}];
const original=JSON.stringify(messages),schema={type:'object',additionalProperties:false,properties:{mode:{type:'string',enum:['read','run']}},required:['mode']};
const submitted=structuredCompletionMessages(messages,schema);
assert.deepEqual(JSON.parse(submitted[0].content.split('Schema: ')[1]),schema);
assert.deepEqual(submitted.slice(1),messages);assert.equal(JSON.stringify(messages),original);
assert.equal(structuredCompletionMessages(messages,null),messages);
// A compatibility retry may remove response_format; the complete schema and
// task meaning remain in exactly the messages sent to the next provider.
const retryBody={messages:submitted,response_format:{type:'json_schema',json_schema:{schema}}};delete retryBody.response_format;
assert.ok(retryBody.messages[0].content.includes(JSON.stringify(schema)));assert.equal(retryBody.messages.at(-1).content,messages.at(-1).content);
console.log('STRUCTURED_COMPLETION_CONTRACT_OK: unsupported-format fallback retains complete schema, immutable task/context, unchanged ordinary calls');
