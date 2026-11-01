import test from 'node:test';
import assert from 'node:assert/strict';
import {HomeAssistantAdapter} from '../src/home-assistant-adapter.js';
import {profile} from '../../backend/src/services/physical/contracts.js';

function fixture(){
  const description=profile('media-device','tv');
  description.properties={app:{type:'string',enum:['video','music']}};
  description.actions={launch_app:{risk:'routine',task:false,input:{type:'object',properties:{app:{type:'string',enum:['video','music']}},required:['app']},expected:{property:'app',input:'app'}}};
  return {id:description.id,profile:'ha-capability',description,
    actionBindings:{launch_app:{transport:'home-assistant-app',entityId:'media_player.fixture',sources:{video:'org.example.video',music:'org.example.music'}}},
    observationBindings:[{entityId:'media_player.fixture',attribute:'app_id',property:'app',states:{'org.example.video':'video','org.example.music':'music'}}]};
}
function adapter(mapping=fixture()){return new HomeAssistantAdapter({url:'http://127.0.0.1',token:'fixture',entities:[mapping]});}

test('friendly app capability translates through fixed catalog and completes only on independent app_id',async()=>{
  const a=adapter(),events=[],calls=[];a.ready=true;a.socket={readyState:1};a.on('event',event=>events.push(event));a.call=async(type,args)=>calls.push({type,...args});
  const command={id:'launch-test',entityId:'media-device',action:'launch_app',input:{app:'video'},expiresAt:Date.now()+5000};
  await a.invokeAction(command);
  assert.deepEqual(calls,[{type:'call_service',domain:'media_player',service:'select_source',target:{entity_id:'media_player.fixture'},service_data:{source:'org.example.video'}}]);
  assert.deepEqual(events.map(event=>event.type),['accepted']);
  const state=(app,extra={})=>({entity_id:'media_player.fixture',state:'idle',last_updated:new Date().toISOString(),attributes:{app_id:app,...extra}});
  a.observe(state('org.example.video',{assumed_state:true}));assert.equal(events.length,1);
  a.observe({...state('org.example.video'),last_updated:new Date(Date.now()-60000).toISOString()});assert.equal(events.at(-1).operationId,null);
  a.observe(state('org.example.music'));assert.ok(a.pending.has(command.entityId));
  a.observe(state('org.example.video'));assert.equal(events.at(-1).operationId,command.id);assert.equal(events.at(-1).value,'video');assert.equal(a.pending.has(command.entityId),false);
  await assert.rejects(()=>a.invokeAction({...command,id:'unapproved',input:{app:'org.other.app'}}));
  await assert.rejects(()=>a.invokeAction({...command,id:'extra',input:{app:'video',source:'org.other.app'}}));
  assert.equal(calls.length,1);
});

test('app mappings reject undeclared apps, non-app observations and alternate HA services',()=>{
  for(const mutate of [
    m=>{m.actionBindings.launch_app.sources.video='!org.example.video';},
    m=>{m.actionBindings.launch_app.entityId='script.anything';},
    m=>{m.description.actions.launch_app.input.properties.app.enum=['video'];},
    m=>{m.observationBindings[0].attribute='access_token';},
    m=>{m.actionBindings.launch_app={domain:'script',service:'turn_on',entityId:'script.launch'};}
  ]){const m=fixture();mutate(m);assert.throws(()=>adapter(m));}
});
