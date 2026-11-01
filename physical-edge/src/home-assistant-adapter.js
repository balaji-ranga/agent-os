import {validateMapping} from '../../backend/src/services/physical/managed-config.js';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import {validateActionBinding,invokeActionBinding} from './action-bindings.js';
import { profile, id, fault, validateInput, validateDescription } from '../../backend/src/services/physical/contracts.js';

export class HomeAssistantAdapter extends EventEmitter {
  static manifest={id:'home-assistant',version:2,profiles:['switch','sensor','tv','ha-capability'],capabilities:['read','invoke','subscribe'],credentialRequirements:['Home Assistant token'],limitations:['Explicit entity mappings only','Requires observed state; optimistic/assumed state is rejected','No robot tasks in Phase 1','TV navigation has no independently verified key feedback; remains uncertain']};
  constructor(config){super();this.config=config;this.pending=new Map();this.states=new Map();this.calls=new Map();this.sequence=0;this.entities=config.entities||[];this.localEntities=structuredClone(this.entities);this.sourceStates=new Map();this.closed=false;
    const url=new URL(config.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw fault('Invalid HA endpoint');
    for(const e of this.entities){id(e.id);if(e.evidenceCameraEntityId&&!/^camera\.[a-z0-9_]+$/.test(e.evidenceCameraEntityId))throw fault('Invalid evidence camera mapping');
      if(e.profile==='ha-capability'){
        validateDescription(e.description);if(e.description.id!==e.id)throw fault('HA capability identity mismatch');
        for(const [action,b]of Object.entries(e.actionBindings||{})){
          if(!e.description.actions[action])throw fault('Invalid HA action binding');
          validateActionBinding(b,e.description.actions[action].input);
        }
        if(Object.keys(e.description.actions).some(a=>!e.actionBindings?.[a]))throw fault('Every HA capability requires an explicit action binding');
        for(const b of e.observationBindings||[]){
          const validSource=b.attribute===undefined?/^(sensor|binary_sensor)\.[a-z0-9_]+$/.test(b.entityId):b.attribute==='app_id'&&/^media_player\.[a-z0-9_]+$/.test(b.entityId);
          if(!validSource||!e.description.properties[b.property]||!b.states||typeof b.states!=='object'||Array.isArray(b.states))throw fault('Invalid HA observation binding');for(const value of Object.values(b.states))validateInput(e.description.properties[b.property],value);
        }
        if(Object.values(e.description.actions).some(a=>!(e.observationBindings||[]).some(b=>b.property===a.expected.property)))throw fault('HA action requires a bound observation');
      }else if(e.profile==='tv'){
        if(!/^remote\.[a-z0-9_]+$/.test(e.haEntityId)||e.mediaEntityId&&!/^media_player\.[a-z0-9_]+$/.test(e.mediaEntityId))throw fault('Invalid TV mapping');
        for(const [key,a]of Object.entries(e.apps||{})){id(key);if(typeof a.activity!=='string'||!a.activity.length||a.activity.length>512||typeof a.observedActivity!=='string'||!a.observedActivity.length)throw fault('TV apps require approved activity and observedActivity');}
        if(e.channels&&(!Array.isArray(e.channels)||e.channels.some(n=>!Number.isInteger(n)||n<1||n>9999)))throw fault('Invalid TV channels');
      }else if(!/^(switch|sensor)\.[a-z0-9_]+$/.test(e.haEntityId)||!['switch','sensor'].includes(e.profile))throw fault('Invalid HA mapping');
    }
  }
  validateManaged(mapping){validateMapping(mapping);new HomeAssistantAdapter({...this.config,entities:[mapping]});}
  replaceManaged(mappings){for(const m of mappings)this.validateManaged(m);const ids=new Set(mappings.map(m=>m.id));this.entities=[...this.localEntities.filter(m=>!ids.has(m.id)),...structuredClone(mappings)];this.states.clear();for(const s of this.sourceStates.values())this.observe(s);}
  integrationEntities(){return [...this.sourceStates.keys()].filter(id=>/^(media_player|button|script|sensor|binary_sensor|camera)\./.test(id));}
  available(deviceId){const e=this.entities.find(e=>e.id===deviceId);if(!this.ready||this.socket?.readyState!==WebSocket.OPEN||!e)return false;const ids=e.profile==='ha-capability'?(e.observationBindings||[]).map(b=>b.entityId):[e.haEntityId];return ids.length>0&&ids.every(id=>{const s=this.sourceStates.get(id);return s&&!['unknown','unavailable'].includes(s.state)&&s.attributes?.assumed_state!==true;});}
  async refresh(){if(!this.ready)return;const states=await this.call('get_states');states.forEach(s=>this.observe(s));}
  async start(){
    if(!this.config.token)throw fault('HA token required');
    this.socket=new WebSocket(new URL('/api/websocket',this.config.url).href.replace(/^http/,'ws'),{maxPayload:1024*1024});
    const socket=this.socket;let connectionTimer,rejectStart;
    this.socket.on('error',()=>{});
    this.socket.on('close',()=>{clearTimeout(connectionTimer);rejectStart?.(fault('HA connection closed',503));this.ready=false;this.sourceStates.clear();for(const c of this.calls.values()){clearTimeout(c.timer);c.reject(fault('HA disconnected',503));}this.calls.clear();if(!this.closed){clearTimeout(this.reconnect);this.reconnect=setTimeout(()=>this.start().catch(()=>{}),1000);}});
    await new Promise((resolve,reject)=>{rejectStart=reject;const timer=connectionTimer=setTimeout(()=>{socket.terminate();reject(fault('HA connection timeout',503));},8000);
      this.socket.on('message',raw=>{let message;try{message=JSON.parse(raw);}catch{return;}
        if(message.type==='auth_required')this.socket.send(JSON.stringify({type:'auth',access_token:this.config.token}));
        if(message.type==='auth_invalid'){clearTimeout(timer);this.socket.close();reject(fault('HA credentials rejected',401));}
        if(message.type==='auth_ok'){this.ready=true;this.call('subscribe_events',{event_type:'state_changed'}).then(()=>this.call('get_states')).then(states=>{states.forEach(s=>this.observe(s));clearTimeout(timer);resolve();}).catch(reject);}
        if(message.type==='result'){const call=this.calls.get(message.id);if(call){this.calls.delete(message.id);clearTimeout(call.timer);message.success?call.resolve(message.result):call.reject(fault('HA service rejected operation',502));}}
        if(message.type==='event'&&message.event?.event_type==='state_changed')this.observe(message.event.data?.new_state);
      });
    });return this;
  }
  call(type,args={}){if(!this.ready||this.socket?.readyState!==WebSocket.OPEN)return Promise.reject(fault('HA unavailable',503));return new Promise((resolve,reject)=>{const n=++this.sequence;const timer=setTimeout(()=>{this.calls.delete(n);reject(fault('HA response timeout',504));},5000);this.calls.set(n,{resolve,reject,timer});this.socket.send(JSON.stringify({id:n,type,...args}));});}
  observe(state){
    if(state?.entity_id)this.sourceStates.set(state.entity_id,state);
    if(!state||state.attributes?.assumed_state===true||['unknown','unavailable'].includes(state.state))return;
    for(const mapping of this.entities.filter(e=>e.haEntityId===state.entity_id||e.mediaEntityId===state.entity_id||(e.observationBindings||[]).some(b=>b.entityId===state.entity_id))){
      const at=Date.parse(state.last_updated);if(!Number.isFinite(at))continue;
      const values={};
      if(mapping.profile==='ha-capability'){
        for(const b of mapping.observationBindings.filter(b=>b.entityId===state.entity_id)){
          const observed=b.attribute?state.attributes?.[b.attribute]:state.state;
          if(typeof observed==='string'&&Object.hasOwn(b.states,observed))values[b.property]=b.states[observed];
        }
      }else if(mapping.profile==='tv'){
        if(state.entity_id===mapping.haEntityId){
          if(['on','off'].includes(state.state))values.on=state.state==='on';
          const activity=state.attributes?.current_activity;
          for(const [key,a]of Object.entries(mapping.apps||{}))if(a.observedActivity===activity)values.app=key;
        }
        if(state.entity_id===mapping.mediaEntityId&&Number.isInteger(state.attributes?.media_channel))values.channel=state.attributes.media_channel;
      }else if(mapping.profile==='switch'){if(['on','off'].includes(state.state))values.on=state.state==='on';}
      else if(state.state!==''&&Number.isFinite(Number(state.state)))values.temperature=Number(state.state);
      for(const [property,value]of Object.entries(values)){
        const td=this.describe(mapping.id);try{validateInput(td.properties[property],value);}catch{continue;}
        this.states.set(mapping.id+':'+property,{value,at});const pending=this.pending.get(mapping.id);
        const event={type:'observation',entityId:mapping.id,property,value,at,operationId:pending&&at>=pending.dispatchedAt&&at<=pending.expiresAt?pending.id:null};
        this.emit('event',event);
        if(event.operationId&&property===pending.expectedProperty&&value===pending.expectedValue)this.pending.delete(mapping.id);
      }
    }
  }
  discover(){return this.entities.map(e=>this.describe(e.id));}
  describe(deviceId){const mapping=this.entities.find(e=>e.id===deviceId);if(!mapping)return null;const td=mapping.profile==='ha-capability'?structuredClone(mapping.description):profile(mapping.id,mapping.profile);td.flolah.simulated=mapping.simulated===true;if(mapping.evidenceCameraEntityId)td.flolah.evidence={visual:true,kind:'camera_snapshot',sourceEntityId:mapping.evidenceCameraEntityId};
    if(mapping.profile==='tv'){
      const apps=Object.keys(mapping.apps||{});if(apps.length)td.actions.launch_app.input.properties.app.enum=apps;else delete td.actions.launch_app;
      if(mapping.mediaEntityId&&mapping.channels?.length)td.actions.select_channel.input.properties.channel.enum=mapping.channels;else delete td.actions.select_channel;
    }return td;}
  pair(deviceId){return this.describe(deviceId);}
  readProperty(deviceId,property){return this.states.get(deviceId+':'+property)||null;}
  async invokeAction(c){
    if(!this.ready||this.socket.readyState!==WebSocket.OPEN)throw fault('HA unavailable',503);
    const e=this.entities.find(e=>e.id===c.entityId),spec=this.describe(c.entityId)?.actions[c.action];if(!e||!spec)throw fault('HA capability unsupported');
    const old=this.pending.get(c.entityId);if(old&&old.expiresAt>Date.now()&&old.id!==c.id)throw fault('HA device already has pending work',409);
    validateInput(spec.input,c.input);
    this.pending.set(c.entityId,{id:c.id,dispatchedAt:Date.now(),expiresAt:c.expiresAt,expectedProperty:spec.expected.property,expectedValue:spec.expected.input?c.input[spec.expected.input]:spec.expected.value});
    let args;
    if(e.profile==='ha-capability'){
      await invokeActionBinding(e.actionBindings[c.action],{input:c.input,callHomeAssistant:args=>this.call('call_service',args)});
      this.emit('event',{type:'accepted',entityId:c.entityId,operationId:c.id,at:Date.now()});
      return;
    }
    else if(e.profile==='switch')args={domain:'switch',service:c.input.on?'turn_on':'turn_off',target:{entity_id:e.haEntityId}};
    else if(c.action==='set_power')args={domain:'remote',service:c.input.on?'turn_on':'turn_off',target:{entity_id:e.haEntityId}};
    else if(c.action==='launch_app')args={domain:'remote',service:'turn_on',target:{entity_id:e.haEntityId},service_data:{activity:e.apps[c.input.app].activity}};
    else if(c.action==='select_channel')args={domain:'media_player',service:'play_media',target:{entity_id:e.mediaEntityId},service_data:{media:{media_content_type:'channel',media_content_id:c.input.channel}}};
    else if(c.action==='navigate')args={domain:'remote',service:'send_command',target:{entity_id:e.haEntityId},service_data:{command:c.input.command}};
    else throw fault('Unsupported TV action');
    await this.call('call_service',args);
    this.emit('event',{type:'accepted',entityId:c.entityId,operationId:c.id,at:Date.now()});
  }
  async captureEvidence(command){
    const mapping=this.entities.find(e=>e.id===command.entityId);if(!mapping?.evidenceCameraEntityId)return [];
    const url=new URL('/api/camera_proxy/'+mapping.evidenceCameraEntityId,this.config.url);
    const response=await fetch(url,{headers:{Authorization:'Bearer '+this.config.token},redirect:'error',signal:AbortSignal.timeout(3000)});
    const mimeType=(response.headers.get('content-type')||'').split(';')[0];if(!response.ok||!['image/png','image/jpeg'].includes(mimeType))throw fault('Evidence camera did not provide an image');
    const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>256*1024)throw fault('Evidence snapshot too large');chunks.push(Buffer.from(chunk));}
    return [{kind:'camera_snapshot',mimeType,data:Buffer.concat(chunks).toString('base64'),at:Date.now()}];
  }
  health(){return {connected:this.ready===true&&this.socket?.readyState===WebSocket.OPEN};}
  async reconcile(command,dispatchedAt){const expected=this.describe(command.entityId)?.actions[command.action]?.expected;if(!expected)throw fault('Unknown action');this.pending.set(command.entityId,{id:command.id,dispatchedAt,expiresAt:command.expiresAt,expectedProperty:expected.property,expectedValue:expected.input?command.input[expected.input]:expected.value});const states=await this.call('get_states');states.forEach(s=>this.observe(s));}
  async close(){this.closed=true;clearTimeout(this.reconnect);this.ready=false;for(const c of this.calls.values()){clearTimeout(c.timer);c.reject(fault('HA closed',503));}this.calls.clear();this.socket?.close();}
}
