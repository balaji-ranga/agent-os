import test from 'node:test';
import assert from 'node:assert/strict';
import {createSocket} from 'node:dgram';
import {setTimeout as delay} from 'node:timers/promises';
import {sendWakePackets,validateWakeBinding} from '../src/wake-on-lan.js';
import {HomeAssistantAdapter} from '../src/home-assistant-adapter.js';
import {profile} from '../../backend/src/services/physical/contracts.js';

test('host wake sends bounded magic packets and requires independent power feedback',async()=>{
  const receiver=createSocket('udp4');
  await new Promise(resolve=>receiver.bind(0,'127.0.0.1',resolve));
  const packets=[];receiver.on('message',data=>packets.push(data));
  try{
    const binding={transport:'wake-on-lan',mac:'02:00:00:00:00:01',address:'127.0.0.1',port:receiver.address().port,count:3,intervalMs:10};
    const description=profile('test-device','switch');
    description.actions={wake:{input:{type:'object',properties:{},required:[]},risk:'routine',task:false,expected:{property:'on',value:true}}};
    const adapter=new HomeAssistantAdapter({url:'http://127.0.0.1',token:'fixture',entities:[{id:description.id,profile:'ha-capability',description,actionBindings:{wake:binding},observationBindings:[{entityId:'binary_sensor.power',property:'on',states:{on:true,off:false}}]}]});
    adapter.ready=true;adapter.socket={readyState:1};
    const events=[];adapter.on('event',event=>events.push(event));
    const command={id:'wake-test',entityId:description.id,action:'wake',input:{},expiresAt:Date.now()+5000};
    await adapter.invokeAction(command);
    for(let i=0;i<20&&packets.length<3;i++)await delay(10);
    assert.equal(packets.length,3);
    const expected=Buffer.concat([Buffer.alloc(6,255),...Array.from({length:16},()=>Buffer.from('020000000001','hex'))]);
    for(const packet of packets)assert.deepEqual(packet,expected);
    assert.deepEqual(events.map(event=>event.type),['accepted']);
    assert.equal(adapter.readProperty(description.id,'on'),null);
    assert.equal(adapter.pending.get(description.id).id,command.id);
    adapter.observe({entity_id:'binary_sensor.power',state:'on',attributes:{assumed_state:true},last_updated:new Date().toISOString()});
    assert.equal(events.length,1);
    adapter.observe({entity_id:'binary_sensor.power',state:'on',attributes:{},last_updated:new Date().toISOString()});
    assert.ok(events.some(event=>event.operationId===command.id&&event.property==='on'&&event.value===true));
  }finally{receiver.close();}
});

test('wake rejects remote destinations, malformed MACs and unbounded packet requests',async()=>{
  const base={mac:'02:00:00:00:00:01',address:'192.168.1.255'};
  for(const extra of [{address:'example.com'},{address:'8.8.8.8'},{mac:'bad'},{count:6},{intervalMs:1001},{port:0}])assert.throws(()=>validateWakeBinding({...base,...extra}));
  await assert.rejects(()=>sendWakePackets({...base,address:'8.8.8.8'}));
});
