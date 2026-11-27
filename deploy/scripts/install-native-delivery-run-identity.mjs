// Carry the host's finalized run identity into the existing final-reply hooks.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
export function adaptDeliveryRunIdentity(source){
 const before='const deliveryParams = {\n\t\t\tcfg,\n\t\t\tdeps: params.deps,\n\t\t\truntime: params.runtime,\n\t\t\topts: params.opts,';
 const after=before.replace('opts: params.opts,','opts: { ...params.opts, runId }, // FLOLAH_FINAL_DELIVERY_RUN_ID');
 if(source.includes(after))return source;
 if(source.split(before).length!==2)throw Error('Unsupported native final delivery run identity ABI');
 return source.replace(before,after);
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/install-native-delivery-run-identity.mjs')){
 const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';let count=0;
 for(const file of readdirSync(root).filter(n=>/^agent-command-.*\.js$/.test(n))){
  const path=join(root,file),source=readFileSync(path,'utf8');if(!source.includes('const deliveryParams = {'))continue;
  writeFileSync(path,adaptDeliveryRunIdentity(source));count++;
 }
 if(count!==1)throw Error('Expected one native command final-delivery boundary');
 console.log('NATIVE_DELIVERY_RUN_IDENTITY_OK');
}
