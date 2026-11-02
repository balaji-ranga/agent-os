import {randomBytes} from 'node:crypto';
import {MqttAdapter,topicRoot} from './mqtt-adapter.js';
import {startTestBroker} from './test-broker.js';
import {Simulator} from './simulator.js';
export async function siteSimulator(config,store){
  const scope={tenantId:config.hub.hubId,siteId:config.hub.siteId,hubId:config.hub.hubId};
  const saved=store('mqtt-identity',{}),identity=saved.load();if(!identity.password){identity.password=randomBytes(32).toString('base64url');saved.save(identity);}
  const root=topicRoot(scope),password=identity.password,broker=await startTestBroker({gateway:{password,root,role:'gateway',discoveryPrefix:scope.hubId},simulator:{password,root,role:'simulator',discoveryPrefix:scope.hubId}});
  const mqtt={...scope,url:broker.url,password};const simulator=new Simulator({...mqtt,username:'simulator'},store('simulator',{devices:{},operations:{}}));
  for(const [id,type]of [['virtual-tv','tv'],['virtual-switch','switch'],['virtual-sensor','sensor'],['virtual-robot','robot']])simulator.add(id,type);
  simulator.add('virtual-camera','camera',{observedDeviceId:'virtual-tv'});
  await simulator.start();return {simulator,adapter:new MqttAdapter({...mqtt,username:'gateway'}),broker};
}
