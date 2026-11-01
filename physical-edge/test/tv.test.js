import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {HomeAssistantAdapter} from '../src/home-assistant-adapter.js';
test('HA TV adapter restricts apps/channels and correlates observed power/app without claiming navigation success',async()=>{
 const adapter=new HomeAssistantAdapter({url:'http://127.0.0.1:8123',token:'fixture',entities:[{id:'prism-fixture',haEntityId:'remote.prism',mediaEntityId:'media_player.prism',profile:'tv',apps:{youtube:{activity:'https://www.youtube.com',observedActivity:'com.google.android.youtube.tv'}},channels:[5],simulated:true}]});
 adapter.ready=true;adapter.socket={readyState:1};const calls=[],events=[];adapter.call=async(type,args)=>calls.push({type,...args});adapter.on('event',e=>events.push(e));
 const command=(action,input)=>({id:randomUUID(),entityId:'prism-fixture',action,input,expiresAt:Date.now()+2000});
 const power=command('set_power',{on:true});await adapter.invokeAction(power);assert.equal(calls.at(-1).domain,'remote');assert.equal(calls.at(-1).service,'turn_on');
 adapter.observe({entity_id:'remote.prism',state:'on',attributes:{},last_updated:new Date().toISOString()});assert.ok(events.some(e=>e.operationId===power.id&&e.property==='on'&&e.value===true));
 const app=command('launch_app',{app:'youtube'});await adapter.invokeAction(app);assert.equal(calls.at(-1).service_data.activity,'https://www.youtube.com');
 adapter.observe({entity_id:'remote.prism',state:'on',attributes:{current_activity:'com.google.android.youtube.tv'},last_updated:new Date().toISOString()});assert.ok(events.some(e=>e.operationId===app.id&&e.property==='app'&&e.value==='youtube'));
 await assert.rejects(()=>adapter.invokeAction(command('launch_app',{app:'unapproved'})));await assert.rejects(()=>adapter.invokeAction(command('select_channel',{channel:6})));
 const channel=command('select_channel',{channel:5});await adapter.invokeAction(channel);assert.equal(calls.at(-1).service_data.media.media_content_id,5);
 adapter.observe({entity_id:'media_player.prism',state:'on',attributes:{media_channel:5,assumed_state:true},last_updated:new Date().toISOString()});assert.ok(!events.some(e=>e.operationId===channel.id&&e.property==='channel'));
 adapter.observe({entity_id:'media_player.prism',state:'on',attributes:{media_channel:5},last_updated:new Date().toISOString()});assert.ok(events.some(e=>e.operationId===channel.id&&e.value===5));
 const nav=command('navigate',{command:'DPAD_DOWN'});await adapter.invokeAction(nav);assert.equal(calls.at(-1).service,'send_command');assert.ok(events.some(e=>e.operationId===nav.id&&e.type==='accepted'));assert.ok(!events.some(e=>e.operationId===nav.id&&e.property==='last_navigation'));
});
