import {EdgeGateway} from '../../src/gateway.js';
import {HomeAssistantAdapter} from '../../src/home-assistant-adapter.js';
import {EventEmitter} from './events.js';
import {profile,validateInput} from '../../../backend/src/services/physical/contracts.js';
const store=name=>({load:()=>JSON.parse(NativeEdge.read(name)),save:value=>NativeEdge.write(name,JSON.stringify(value))});
class VirtualAdapter extends EventEmitter {
 static manifest={version:1};constructor(){super();this.values=JSON.parse(NativeEdge.read('simulator'))||{on:false,app:'home',channel:1,last_navigation:'HOME'};}
 async start(){} discover(){return [profile('android-virtual-tv','tv')];}describe(){return this.discover()[0];}readProperty(id,p){return {value:this.values[p],at:Date.now()};}health(){return {connected:true};}async close(){}
 async invokeAction(c){const spec=this.describe().actions[c.action];validateInput(spec.input,c.input);const property=spec.expected.property,value=c.input[spec.expected.input];this.emit('event',{type:'accepted',entityId:c.entityId,operationId:c.id,at:Date.now()});this.values[property]=value;NativeEdge.write('simulator',JSON.stringify(this.values));this.emit('event',{type:'observation',entityId:c.entityId,operationId:c.id,property,value,at:Date.now()});}
}
let gateway;const output=document.getElementById('status'),config=document.getElementById('config');config.value=NativeEdge.read('config')==='null'?'':NativeEdge.read('config');
window.stopEdge=()=>{gateway?.close();gateway=null;output.textContent='Stopped. Keep this foreground pilot open while testing.';};
document.getElementById('stop').onclick=window.stopEdge;
document.getElementById('start').onclick=async()=>{try{await gateway?.close();const c=JSON.parse(config.value);if(!c.hub?.cloudUrl?.startsWith('wss://'))throw Error('Cloud WSS required');const adapters={};for(const [name,a]of Object.entries(c.adapters||{})){if(a.type!=='home-assistant'||!a.url?.startsWith('https://'))throw Error('Android pilot supports HTTPS Home Assistant adapters only');adapters[name]=new HomeAssistantAdapter(a);}if(!Object.keys(adapters).length)adapters.simulator=new VirtualAdapter();NativeEdge.write('config',JSON.stringify(c));gateway=new EdgeGateway(c.hub,store('gateway'),adapters);await gateway.start();output.textContent='Connecting…';config.value='';}catch(e){output.textContent=e.message;}};
setInterval(()=>{if(gateway)output.textContent=JSON.stringify({connected:gateway.connected,hubId:gateway.config.hubId,adapters:gateway.status().adapters,pendingEvents:gateway.state.events.length},null,2);},1500);
