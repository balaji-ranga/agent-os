// Pinned OpenClaw heartbeat-only ABI adaptation; unknown runtimes fail the build.
import {readFileSync,readdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const dist=resolve(process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist');
const root=resolve(process.argv[3]||'/opt/agent-os');
const files=readdirSync(dist).filter(n=>/^heartbeat-runner-.*\.js$/.test(n)&&readFileSync(join(dist,n),'utf8').includes('function normalizeHeartbeatReply('));
if(!files.length)throw Error('Unsupported OpenClaw heartbeat ABI: missing runner.');
const anchor='const isSilentReply = isSilentReplyPayloadText(textForStrip);';
const patched='const isSilentReply = isSilentReplyPayloadText(textForStrip) || (mode === "heartbeat" && isIdleHeartbeatReply({ ...payload, text: textForStrip }));';
const scratch='const heartbeatScratchContent = monitorScratch?.state.scratch?.content;';
const fallback='const heartbeatScratchContent = monitorScratch?.state.scratch?.content ?? (!flolahScratchReadFailed ? readLegacyHeartbeatContent(params.cfg, params.agentId, params.heartbeat) : undefined);';
const importLine="import {isIdleHeartbeatReply,readLegacyHeartbeatContent} from './flolah-heartbeat-silence.js';";
for(const file of files){
 const path=join(dist,file);let source=readFileSync(path,'utf8');
 if(!source.includes(patched)){
  if(source.split(anchor).length!==2||!source.includes('function normalizeHeartbeatReply(payload, responsePrefix, ackMaxChars, mode = "heartbeat")'))throw Error('Unsupported OpenClaw heartbeat ABI: '+file);
  source="import {isIdleHeartbeatReply} from './flolah-heartbeat-silence.js';\n"+source.replace(anchor,patched);
 }
 if(!source.includes(fallback)){
  const start=source.indexOf('function resolveHeartbeatPreflight(params) {'),end=source.indexOf('\n}',start)+2;
  if(start<0||end<=start)throw Error('Unsupported OpenClaw heartbeat preflight ABI: '+file);
  let preflight=source.slice(start,end);
  for(const needle of [scratch,'let monitorScratch;','catch (error) {'])if(preflight.split(needle).length!==2)throw Error('Unsupported OpenClaw heartbeat preflight ABI: '+file);
  preflight=preflight.replace('let monitorScratch;','let monitorScratch;\n\tlet flolahScratchReadFailed = false;').replace('catch (error) {','catch (error) {\n\t\tflolahScratchReadFailed = true;').replace(scratch,fallback);
  source=source.slice(0,start)+preflight+source.slice(end);
 }
 source=source.replace("import {isIdleHeartbeatReply} from './flolah-heartbeat-silence.js';",importLine);
 if(!source.includes(importLine))throw Error('Unsupported OpenClaw heartbeat helper import ABI: '+file);
 writeFileSync(path,source);
}
copyFileSync(join(root,'openclaw-extensions/agent-os-content-tools/heartbeat-silence.js'),join(dist,'flolah-heartbeat-silence.js'));
console.log('NATIVE_HEARTBEAT_SILENCE_INSTALLED: '+files.length+' heartbeat module(s)');
