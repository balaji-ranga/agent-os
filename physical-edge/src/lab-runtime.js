import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { randomUUID,randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { writeFileSync,existsSync,readFileSync } from 'node:fs';
import { PhysicalControlPlane,emptyState } from '../../backend/src/services/physical/control-plane.js';
import { attachPhysicalHubServer } from '../../backend/src/services/physical/socket-server.js';
import {createPhysicalEvidenceStore} from '../../backend/src/services/physical/evidence-store.js';
import { FileStore } from './store.js';
import { topicRoot,MqttAdapter } from './mqtt-adapter.js';
import { Simulator } from './simulator.js';
import { EdgeGateway } from './gateway.js';
import { startTestBroker } from './test-broker.js';
import { localServer } from './local-server.js';

const require=createRequire(new URL('../../backend/package.json',import.meta.url));
const express=require('express');
const secret=()=>randomBytes(32).toString('base64url');
export async function startLab({dataDir,cloudPort=0,uiPort=0}={}){
  const stores=[];const store=(name,initial)=>{const s=new FileStore(join(dataDir,name+'.json'),initial);stores.push(s);return s;};
  const plane=new PhysicalControlPlane(store('cloud',emptyState()),{evidenceStore:createPhysicalEvidenceStore(join(dataDir,'evidence'))});
  const {physicalApiRouter:physicalRouter}=await import('../../backend/src/routes/physical-api.js');
  const app=express();app.use(express.json({limit:'64kb'}));
  const previous=existsSync(join(dataDir,'access.json'))?JSON.parse(readFileSync(join(dataDir,'access.json'),'utf8')):null;
  const ownerId=previous?.ownerId||'lab-'+randomUUID(),sessionToken=previous?.sessionToken||secret(),localToken=previous?.localToken||secret();
  const auth=(req,res,next)=>{if(req.headers.authorization!=='Bearer '+sessionToken)return res.status(401).json({error:'Lab authentication required'});req.authUser={id:ownerId,role:'ceo'};next();};
  app.use('/api/physical',physicalRouter({plane,auth:[auth],owner:req=>req.authUser.id}));
  const cloud=createServer(app);const sockets=attachPhysicalHubServer(cloud,plane);await new Promise(r=>cloud.listen(cloudPort,'127.0.0.1',r));
  const hub=previous?.hub||plane.enroll(ownerId,{siteId:'lab-site',name:'Windows-compatible simulator lab'});
  const scope={tenantId:ownerId,siteId:hub.siteId,hubId:hub.hubId};const root=topicRoot(scope),password=previous?.mqttPassword||secret();
  const accounts={gateway:{password,root,role:'gateway',discoveryPrefix:hub.hubId},simulator:{password,root,role:'simulator',discoveryPrefix:hub.hubId}};
  const broker=await startTestBroker(accounts);
  const mqttConfig={...scope,url:broker.url,password};
  const simulator=new Simulator({...mqttConfig,username:'simulator'},store('simulator',{devices:{},operations:{}}));
  simulator.add('lab-switch','switch');simulator.add('lab-sensor','sensor');simulator.add('lab-robot','robot');simulator.add('lab-tv','tv');simulator.add('lab-camera','camera',{observedDeviceId:'lab-tv'});await simulator.start();
  let adapter=new MqttAdapter({...mqttConfig,username:'gateway'});
  const gatewayConfig={cloudUrl:'ws://127.0.0.1:'+cloud.address().port+'/api/physical/hub',allowInsecureLocal:true,hubId:hub.hubId,siteId:scope.siteId,token:hub.token};
  const gatewayStore=store('gateway',{configuration:null,journal:{},events:[],offlineUses:{}});
  let gateway=new EdgeGateway(gatewayConfig,gatewayStore,{mqtt:adapter});
  await gateway.start();const local=localServer({token:localToken,gateway:()=>gateway,simulator});await new Promise(r=>local.listen(uiPort,'127.0.0.1',r));
  const result={cloudUrl:'http://127.0.0.1:'+cloud.address().port,uiUrl:'http://127.0.0.1:'+local.address().port,sessionToken,localToken,ownerId,hub,scope,mqttConfig,plane,get gateway(){return gateway;},simulator,broker,get adapter(){return adapter;},
    async restartGateway(){await gateway.close();adapter=new MqttAdapter({...mqttConfig,username:'gateway'});gateway=new EdgeGateway(gatewayConfig,gatewayStore,{mqtt:adapter});await gateway.start();return gateway;},
    async close(){await gateway.close();await simulator.close();await sockets.close();await broker.close();await new Promise(r=>local.close(r));await new Promise(r=>cloud.close(r));for(const s of stores)s.close();}};
  writeFileSync(join(dataDir,'access.json'),JSON.stringify({cloudUrl:result.cloudUrl,uiUrl:result.uiUrl,sessionToken,localToken,ownerId,hubId:hub.hubId,hub,mqttPassword:password},null,2),{mode:0o600});
  return result;
}
