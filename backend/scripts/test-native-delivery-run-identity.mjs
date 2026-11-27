import assert from 'node:assert/strict';
import {adaptDeliveryRunIdentity} from '../../deploy/scripts/install-native-delivery-run-identity.mjs';
const fixture='const deliveryParams = {\n\t\t\tcfg,\n\t\t\tdeps: params.deps,\n\t\t\truntime: params.runtime,\n\t\t\topts: params.opts,\n}; return deliveryParams;';
const changed=adaptDeliveryRunIdentity(fixture);
assert.equal(adaptDeliveryRunIdentity(changed),changed);assert.throws(()=>adaptDeliveryRunIdentity('unknown runtime'),/Unsupported/);
const make=new Function('cfg','params','runId',changed),opts={runId:'stale-request-id',deliver:true,replyChannel:'whatsapp'};
const result=make({}, {deps:{},runtime:{},opts},'host-finalized-run');
assert.equal(result.opts.runId,'host-finalized-run');assert.equal(result.opts.replyChannel,'whatsapp');assert.equal(result.opts.deliver,true);assert.equal(opts.runId,'stale-request-id');
console.log('NATIVE_DELIVERY_RUN_IDENTITY_TEST_OK: final hooks receive finalized host run; routing preserved; caller options unchanged; repeat install and ABI guard');
