import {loadGatewayConfig} from './config.js';
import { FileStore } from './store.js';
import { MqttAdapter } from './mqtt-adapter.js';
import { HomeAssistantAdapter } from './home-assistant-adapter.js';
import { EdgeGateway } from './gateway.js';
import { Simulator } from './simulator.js';
import { localServer } from './local-server.js';
import { siteSimulator } from './site-simulator.js';
import { resolve,join } from 'node:path';

const path=process.argv[2];if(!path)throw Error('Usage: npm start -- <protected-config.json>');
const config=loadGatewayConfig(path),stores=[],dataDir=resolve(config.dataDir);
function store(name,initial){const s=new FileStore(join(dataDir,name+'.json'),initial);stores.push(s);return s;}
const adapters={};
for(const [name,value]of Object.entries(config.adapters||{})){
  // Code is curated in this allowlist; never import a module path from a device or config.
  if(value.type==='mqtt')adapters[name]=new MqttAdapter(value);
  else if(value.type==='home-assistant')adapters[name]=new HomeAssistantAdapter(value);
  else throw Error('Unapproved adapter type');
}
let simulator,siteLab;
if(!Object.keys(adapters).length||config.includeSimulator===true){siteLab=await siteSimulator(config,store);simulator=siteLab.simulator;adapters.simulator=siteLab.adapter;console.log(Object.keys(config.adapters||{}).length?'Simulator profiles enabled alongside configured device adapters.':'Simulator-only hub: virtual TV, room camera, switch, sensor and robot. No real device controls.');}
if(config.simulator){simulator=new Simulator(config.simulator.mqtt,store('simulator',{devices:{},operations:{}}));for(const d of config.simulator.devices)simulator.add(d.id,d.profile);await simulator.start();}
const gateway=new EdgeGateway(config.hub,store('gateway',{configuration:null,journal:{},events:[],offlineUses:{}}),adapters);
await gateway.start();
const server=localServer({token:config.localToken,gateway,simulator});server.listen(config.uiPort||0,config.uiBind||'127.0.0.1',()=>console.log('Local physical pilot UI port: '+server.address().port));
async function close(){server.close();await gateway.close();await simulator?.close();await siteLab?.broker.close();for(const s of stores)s.close();process.exit(0);}
process.once('SIGINT',close);process.once('SIGTERM',close);
