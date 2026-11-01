import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { topicRoot } from '../src/mqtt-adapter.js';
// Read the one-time hub enrollment response from a protected file, never command arguments.
if(!process.argv[2])throw Error('Usage: node scripts/setup.mjs <enrollment-and-cloud-config.json>');
const enrollment=JSON.parse(readFileSync(process.argv[2],'utf8'));
const root=fileURLToPath(new URL('../.local/',import.meta.url));
mkdirSync(join(root,'config'),{recursive:true,mode:0o700});mkdirSync(join(root,'mosquitto'),{recursive:true,mode:0o700});
const secret=()=>randomBytes(32).toString('base64url');
const scope={tenantId:enrollment.tenantId,siteId:enrollment.siteId,hubId:enrollment.hubId};const prefix=topicRoot(scope);
const gatewayPassword=secret(),simulatorPassword=secret(),haPassword=secret();
const gateway={dataDir:'/data',localToken:secret(),uiBind:'0.0.0.0',uiPort:8791,hub:{cloudUrl:enrollment.cloudUrl,hubId:scope.hubId,siteId:scope.siteId,token:enrollment.token},adapters:{mqtt:{type:'mqtt',...scope,url:'mqtt://broker:1883',username:'gateway',password:gatewayPassword}}};
const simulator={dataDir:'/data',localToken:secret(),uiBind:'0.0.0.0',uiPort:8792,mqtt:{...scope,url:'mqtt://broker:1883',username:'simulator',password:simulatorPassword},devices:[{id:'pilot-switch',profile:'switch'},{id:'pilot-sensor',profile:'sensor'},{id:'pilot-robot',profile:'robot'}]};
for(const [name,value]of Object.entries({gateway,simulator,'ha-connection':{username:'homeassistant',password:haPassword,broker:'broker',port:1883}}))writeFileSync(join(root,'config',name+'.json'),JSON.stringify(value,null,2),{mode:0o600,flag:'wx'});
writeFileSync(join(root,'mosquitto/mosquitto.conf'),'listener 1883\nallow_anonymous false\npassword_file /mosquitto/config/passwords\nacl_file /mosquitto/config/acl\npersistence true\npersistence_location /mosquitto/data/\n');
const discovery=['switch/pilot-switch','sensor/pilot-sensor'].map(s=>{const [kind,device]=s.split('/');return 'homeassistant/'+kind+'/'+scope.hubId+'_'+device+'/config';});
const acl=`user gateway\ntopic read ${prefix}/+/event\ntopic write ${prefix}/+/command\ntopic write ${prefix}/+/cancel\ntopic write ${prefix}/+/read\n\nuser simulator\ntopic read ${prefix}/+/command\ntopic read ${prefix}/+/cancel\ntopic read ${prefix}/+/read\ntopic read ${prefix}/+/ha/set\ntopic write ${prefix}/+/event\ntopic write ${prefix}/+/ha/state\n${discovery.map(t=>'topic write '+t).join('\n')}\n\nuser homeassistant\n${discovery.map(t=>'topic read '+t).join('\n')}\ntopic read ${prefix}/+/ha/state\ntopic write ${prefix}/+/ha/set\ntopic readwrite homeassistant/status\n`;
writeFileSync(join(root,'mosquitto/acl'),acl);
// mosquitto_passwd -U hashes a temporary plaintext credential file in-place.
// Secrets are passed through a protected bind-mounted file, not shell arguments or stdout.
writeFileSync(join(root,'mosquitto/passwords'),`gateway:${gatewayPassword}\nsimulator:${simulatorPassword}\nhomeassistant:${haPassword}\n`,{mode:0o600,flag:'wx'});
const result=spawnSync('docker',['run','--rm','-v',join(root,'mosquitto')+':/config','eclipse-mosquitto:2','mosquitto_passwd','-U','/config/passwords'],{stdio:'inherit'});
if(result.status!==0)throw Error('Password hashing failed. Do not start the broker; remove the incomplete .local configuration before retrying.');
console.log('Protected configuration and scoped Mosquitto ACLs created in '+root+'. Review files before starting the separate edge Compose project.');
