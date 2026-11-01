import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {randomUUID,createHash} from 'node:crypto';import {createServer} from 'node:http';import WebSocket from 'ws';import {PhysicalControlPlane,emptyState} from '../../backend/src/services/physical/control-plane.js';import {attachPhysicalHubServer} from '../../backend/src/services/physical/socket-server.js';
const until=async(fn)=>{const start=Date.now();while(!fn()){if(Date.now()-start>5000)throw Error('Android JS bridge fixture timeout');await new Promise(r=>setTimeout(r,20));}};
test('APK bundled gateway uses shared wire/policy and durable journal through native bridge fixture',async()=>{
 let saved=emptyState();const plane=new PhysicalControlPlane({load:()=>saved,save:s=>{saved=s;}}),hub=plane.enroll('android-fixture',{siteId:'test-site',name:'Android bridge fixture'});
 const server=createServer();const sockets=attachPhysicalHubServer(server,plane);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='ws://127.0.0.1:'+server.address().port+'/api/physical/hub';const config={hub:{...hub,cloudUrl:url.replace('ws:','wss:')},adapters:{}};
 const data=new Map([['config',JSON.stringify(config)]]),nativeSockets=new Map(),timers=[];
 const elements={config:{value:''},status:{textContent:''},start:{},stop:{}};let context;
 const NativeEdge={uuid:randomUUID,sha256:text=>createHash('sha256').update(text).digest('hex'),read:name=>data.get(name)||'null',write:(name,value)=>data.set(name,value),
 open(id,target,headers){assert.ok(target.startsWith('wss:'));const socket=new WebSocket(url,{headers:JSON.parse(headers)});nativeSockets.set(id,socket);socket.on('open',()=>context.nativeSocketEvent(id,'open',''));socket.on('message',bytes=>context.nativeSocketEvent(id,'message',bytes.toString()));socket.on('close',()=>{nativeSockets.delete(id);context.nativeSocketEvent(id,'close','');});socket.on('error',()=>{});},send:(id,text)=>nativeSockets.get(id)?.send(text),close:id=>nativeSockets.get(id)?.close()};
 context=vm.createContext({NativeEdge,document:{getElementById:id=>elements[id]},URL,structuredClone,console,setTimeout,clearTimeout,setInterval:(fn,ms)=>{const timer=setInterval(fn,ms);timers.push(timer);return timer;}});context.window=context;
 try{
 vm.runInContext(readFileSync(new URL('../android/app/src/main/assets/edge.js',import.meta.url),'utf8'),context);await elements.start.onclick();await until(()=>plane.state.hubs[hub.hubId].candidates.length===1);
 const entity=plane.register('android-fixture',{hubId:hub.hubId,candidateId:'android-virtual-tv',actions:{set_power:'autonomous'}});await new Promise(r=>setTimeout(r,100));
 const operation=plane.operation('android-fixture',{entityId:entity.id,action:'set_power',input:{on:true},idempotencyKey:randomUUID()});await until(()=>plane.state.operations[operation.id].status==='completed');assert.equal(plane.state.operations[operation.id].evidence.value,true);
 assert.equal(JSON.parse(data.get('gateway')).journal[operation.id].status,'completed');context.stopEdge();
 console.log('ANDROID_BUNDLED_JS_PASS: native bridge is an explicit fixture; not Android OS/device acceptance');
 }finally{context.stopEdge?.();for(const timer of timers)clearInterval(timer);for(const socket of nativeSockets.values())socket.terminate();await sockets.close();await new Promise(r=>server.close(r));}
});
