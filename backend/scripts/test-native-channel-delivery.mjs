import assert from 'node:assert/strict';
import {adaptChannelDelivery} from '../../deploy/scripts/install-native-channel-delivery.mjs';
const fixture=`function createMessageTool(options) { return async function(action) { return runMessageActionForTool({conversationReadOrigin: options?.conversationReadOrigin, params: {channel:'fixture'}}); }; }`;
const patched=adaptChannelDelivery(fixture);
assert.equal(adaptChannelDelivery(patched),patched);
assert.throws(()=>adaptChannelDelivery('unknown ABI'),/Unsupported/);
const calls=[];
const create=new Function('runMessageActionForTool',patched+'; return createMessageTool;')(async x=>{calls.push(x);return x;});
await create({conversationReadOrigin:'direct-operator'})('send');
assert.equal(calls.at(-1).gatewayOwnedDelivery,true);
assert.equal(calls.at(-1).forceCoreDelivery,true);
for(const [origin,action] of [['direct-operator','delete'],['agent','send'],[undefined,'send']]){
 await create({conversationReadOrigin:origin})(action);
 assert.equal(calls.at(-1).gatewayOwnedDelivery,undefined,'only trusted in-process sends bypass nested transport');
}
console.log('NATIVE_CHANNEL_DELIVERY_OK: direct operator send; normal authorization boundary; other calls unchanged; idempotent ABI adaptation');
