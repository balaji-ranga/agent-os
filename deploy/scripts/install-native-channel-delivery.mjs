// Gateway-authenticated HTTP message calls already execute inside the gateway.
// Keep validation/authorization in the native action runner, but do not open a
// second gateway connection (the CLI path has an unrelated 10s timeout).
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export function adaptChannelDelivery(source){
 const anchor='conversationReadOrigin: options?.conversationReadOrigin,';
 const patch=anchor+'\n\t\t\t\t\t// flolah-direct-operator-channel-delivery\n\t\t\t\t\t...(options?.conversationReadOrigin === "direct-operator" && action === "send" ? { gatewayOwnedDelivery: true, forceCoreDelivery: true } : {}),';
 if(source.includes('// flolah-direct-operator-channel-delivery'))return source;
 if(!source.includes('function createMessageTool(options)')||source.split(anchor).length!==2||!source.includes('runMessageActionForTool({'))throw Error('Unsupported native message delivery ABI');
 return source.replace(anchor,patch);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const dist=resolve(process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist');
 const files=readdirSync(dist).filter(n=>/^openclaw-tools-.*\.js$/.test(n)&&readFileSync(join(dist,n),'utf8').includes('function createMessageTool(options)'));
 if(!files.length)throw Error('Missing native message delivery ABI');
 for(const file of files){const p=join(dist,file);writeFileSync(p,adaptChannelDelivery(readFileSync(p,'utf8')));}
 console.log('NATIVE_CHANNEL_DELIVERY_INSTALLED: '+files.length);
}
