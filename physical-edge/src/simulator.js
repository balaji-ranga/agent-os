import mqtt from 'mqtt';
import {simulatorSnapshot} from './simulator-snapshot.js';
import { id, profile, fingerprint, validateCommand, fault } from '../../backend/src/services/physical/contracts.js';
import { topicRoot } from './mqtt-adapter.js';

export class Simulator {
  constructor(config,store){this.config=config;this.store=store;this.state=store.load()||{devices:{},operations:{}};this.root=topicRoot(config);this.timers=new Set();}
  add(deviceId,kind){id(deviceId);if(!this.state.devices[deviceId])this.state.devices[deviceId]={description:profile(deviceId,kind),values:kind==='switch'?{on:false}:kind==='sensor'?{temperature:22}:kind==='tv'?{on:false,app:'home',channel:1,last_navigation:'HOME'}:{task_state:'idle'},mode:'normal',delayMs:50};if(kind==='tv')this.state.devices[deviceId].description.flolah.evidence={visual:true,kind:'simulator_snapshot'};this.save();}
  save(){this.store.save(this.state);}
  async start(){
    this.client=mqtt.connect(this.config.url,{username:this.config.username,password:this.config.password,reconnectPeriod:500});this.client.on('error',()=>{});
    this.client.on('connect',()=>{this.client.subscribe([this.root+'/+/command',this.root+'/+/cancel',this.root+'/+/read',this.root+'/+/ha/set'],{qos:1});this.announce();});
    this.client.on('message',(topic,bytes)=>{if(bytes.length>65536)return;try{
      if(topic.endsWith('/ha/set')){const deviceId=topic.split('/').at(-3),d=this.state.devices[deviceId],payload=bytes.toString();if(!d||!['ON','OFF'].includes(payload))return;this.execute(deviceId,{id:crypto.randomUUID(),entityId:deviceId,action:'set_state',input:{on:payload==='ON'},descriptionHash:fingerprint(d.description),authorized:true,expiresAt:Date.now()+30000});return;}
      const deviceId=topic.split('/').at(-2),cmd=JSON.parse(bytes),type=topic.split('/').at(-1);
      if(type==='read'){
        const previous=this.state.operations[cmd.operationId];
        if(previous?.deviceId===deviceId&&previous.event)this.publish(previous.event);
        else if(cmd.operationId)this.publish({type:'uncertain',entityId:deviceId,operationId:cmd.operationId,error:'No durable device outcome',at:Date.now()});
        else this.report(deviceId);
      }else if(type==='cancel')this.cancel(deviceId,cmd.id);else this.execute(deviceId,cmd);
    }catch{/* reject malformed messages without mutation */}});
    await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(fault('Simulator broker timeout',503)),6000);this.client.once('connect',()=>{clearTimeout(t);resolve();});});return this;
  }
  publish(event){if(this.client?.connected)this.client.publish(this.root+'/'+event.entityId+'/event',JSON.stringify(event),{qos:1,retain:event.type==='description'});}
  announce(){for(const [deviceId,d]of Object.entries(this.state.devices)){
    this.publish({type:'description',entityId:deviceId,description:d.description});
    const kind=d.description.flolah.profile;
    if(['switch','sensor'].includes(kind)&&this.client.connected){const discoveryId=this.config.hubId+'_'+deviceId,config={name:discoveryId,unique_id:discoveryId,state_topic:this.root+'/'+deviceId+'/ha/state',...(kind==='switch'?{command_topic:this.root+'/'+deviceId+'/ha/set',payload_on:'ON',payload_off:'OFF',optimistic:false}:{device_class:'temperature',unit_of_measurement:'°C'})};this.client.publish('homeassistant/'+kind+'/'+discoveryId+'/config',JSON.stringify(config),{qos:1,retain:true});}
    this.report(deviceId);
  }}
  report(deviceId,operationId=null){const d=this.state.devices[deviceId];if(!d||d.mode==='offline')return;for(const [property,value]of Object.entries(d.values))this.publish({type:'observation',entityId:deviceId,property,value,operationId,at:Date.now()});this.haState(deviceId);}
  haState(deviceId){const d=this.state.devices[deviceId];if(this.client?.connected&&d.mode!=='offline')this.client.publish(this.root+'/'+deviceId+'/ha/state',d.description.flolah.profile==='switch'?(d.values.on?'ON':'OFF'):String(d.values.temperature),{qos:1,retain:true});}
  later(fn,ms){const t=setTimeout(()=>{this.timers.delete(t);fn();},ms);this.timers.add(t);}
  execute(deviceId,c){
    const d=this.state.devices[deviceId];if(!d||d.mode==='offline')return;
    validateCommand(c,{id:deviceId,description:d.description});
    const digest=fingerprint(c),old=this.state.operations[c.id];
    if(old){if(old.digest!==digest)return;if(old.event)this.publish(old.event);return;}
    this.state.operations[c.id]={digest,deviceId,sideEffects:0,status:'accepted'};this.save();
    if(d.mode!=='lost_ack')this.publish({type:'accepted',entityId:deviceId,operationId:c.id,at:Date.now()});
    if(d.mode==='accepted_only')return;
    if(d.mode==='fail'){this.finish(c.id,{type:'failed',entityId:deviceId,operationId:c.id,error:'Injected simulator failure',at:Date.now()});return;}
    if(d.description.actions[c.action].task){d.values.task_state='running';this.publish({type:'running',entityId:deviceId,operationId:c.id,progress:25,at:Date.now()});}
    this.later(()=>{
      if(this.state.operations[c.id].status==='cancelled'||d.mode==='offline')return;
      if(c.expiresAt<=Date.now()){this.finish(c.id,{type:'failed',entityId:deviceId,operationId:c.id,error:'Simulator command expired',at:Date.now()});return;}
      const expected=d.description.actions[c.action].expected,prop=expected.property,value=expected.input?c.input[expected.input]:expected.value;
      d.values[prop]=value;this.state.operations[c.id].sideEffects++;
      this.finish(c.id,{type:'observation',entityId:deviceId,operationId:c.id,property:prop,value,at:d.mode==='stale'?c.expiresAt-400000:Date.now()});
    },d.delayMs);
  }
  finish(operationId,event){if(event.type==='observation'&&this.state.devices[event.entityId]?.description.flolah.profile==='tv')event={...event,attachments:[simulatorSnapshot(this.state.devices[event.entityId].values,event.at)]};this.state.operations[operationId].event=event;this.state.operations[operationId].status=event.type==='observation'?'completed':event.type;this.save();this.publish(event);if(event.type==='observation'&&this.state.devices[event.entityId].mode!=='stale')this.haState(event.entityId);}
  cancel(deviceId,operationId){const op=this.state.operations[operationId],d=this.state.devices[deviceId];if(!op||op.deviceId!==deviceId||d.description.flolah.kind!=='PhysicalAgent')return;if(op.status==='completed')return;d.values.task_state='cancelled';this.finish(operationId,{type:'cancelled',entityId:deviceId,operationId,at:Date.now()});}
  control(deviceId,{mode,delayMs,temperature}){
    const d=this.state.devices[id(deviceId)];if(!d)throw fault('Unknown simulator device',404);
    if(mode!==undefined){if(!['normal','offline','accepted_only','lost_ack','stale','fail'].includes(mode))throw fault('Invalid fault mode');d.mode=mode;}
    if(delayMs!==undefined){if(!Number.isInteger(delayMs)||delayMs<0||delayMs>300000)throw fault('Invalid delay');d.delayMs=delayMs;}
    if(temperature!==undefined){if(d.description.flolah.profile!=='sensor'||typeof temperature!=='number'||!Number.isFinite(temperature))throw fault('Invalid temperature');d.values.temperature=temperature;}
    this.save();this.report(deviceId);
  }
  async close(){for(const t of this.timers)clearTimeout(t);this.timers.clear();if(this.client)await this.client.endAsync();}
}
