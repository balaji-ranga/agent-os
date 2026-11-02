import mqtt from 'mqtt';
import { EventEmitter } from 'node:events';
import { id, fault, fingerprint } from '../../backend/src/services/physical/contracts.js';

export function topicRoot({tenantId,siteId,hubId}) { return ['flolah','physical',id(tenantId),id(siteId),id(hubId)].join('/'); }
export class MqttAdapter extends EventEmitter {
  static manifest={id:'mqtt',version:1,profiles:['switch','sensor','robot','tv','camera'],capabilities:['read','invoke','subscribe','tasks'],credentialRequirements:['broker username/password'],limitations:['Only configured canonical device protocol; not arbitrary MQTT payloads']};
  constructor(config){super();this.config=config;this.root=topicRoot(config);this.descriptions=new Map();this.latest=new Map();if(config.entityIds!==undefined){if(!Array.isArray(config.entityIds))throw fault('Invalid MQTT entity allowlist');config.entityIds.forEach(id);}}
  async start(){
    if(!this.config.username||!this.config.password)throw fault('MQTT credentials required');
    this.client=mqtt.connect(this.config.url,{username:this.config.username,password:this.config.password,reconnectPeriod:500,clean:true,connectTimeout:5000});
    this.client.on('error',()=>{});
    this.client.on('connect',()=>this.client.subscribe(this.root+'/+/event',{qos:1}));
    this.client.on('message',(topic,bytes)=>{try{
      if(bytes.length>65536)return;
      const e=JSON.parse(bytes);const parts=topic.split('/');const device=parts.at(-2);
      if(!topic.startsWith(this.root+'/')||e.entityId!==device)return;
      if(this.config.entityIds&&!this.config.entityIds.includes(device))return;
      if(e.type==='description')this.descriptions.set(device,e.description);
      if(e.type==='observation')this.latest.set(device+':'+e.property,e);
      this.emit('event',e);
    }catch{/* malformed untrusted device data does not crash the process */}});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(fault('MQTT connection timeout',503)),6000);this.client.once('connect',()=>{clearTimeout(timer);resolve();});});
    return this;
  }
  discover(){return [...this.descriptions.values()];}
  pair(candidate){return this.descriptions.get(candidate)||null;}
  describe(device){return this.pair(device);}
  readProperty(device,property){return this.latest.get(id(device)+':'+id(property))||null;}
  async refresh(device){await this.client.publishAsync(this.root+'/'+id(device)+'/read','{}',{qos:1,retain:false});}
  async invokeAction(command){
    if(!this.client.connected)throw fault('MQTT disconnected; operation state uncertain',503);
    // Translate the governed profile's adapter envelope into the device protocol profile.
    const translated={...command,descriptionHash:fingerprint(this.describe(command.entityId))};
    await this.client.publishAsync(this.root+'/'+id(command.entityId)+'/command',JSON.stringify(translated),{qos:1,retain:false});
  }
  startTask(command){return this.invokeAction(command);}
  async reconcile(command){await this.client.publishAsync(this.root+'/'+id(command.entityId)+'/read',JSON.stringify({operationId:command.id}),{qos:1,retain:false});}
  async cancelTask(command){await this.client.publishAsync(this.root+'/'+id(command.entityId)+'/cancel',JSON.stringify({id:command.id}),{qos:1,retain:false});}
  health(){return {connected:!!this.client?.connected};}
  async close(){if(this.client)await this.client.endAsync();}
}
