import {readFileSync} from 'node:fs';
import {assertOpenClawConfigContract} from '../../scripts/lib/openclaw-config-contract.js';
const seeds=['openclaw-config.example.json','openclaw-config.example-multi-agent.json','openclaw-config-gateway-agents.json'];
for(const name of seeds){
 const config=JSON.parse(readFileSync(new URL('../../'+name,import.meta.url),'utf8'));assertOpenClawConfigContract(config);
 for(const provider of Object.values(config.models?.providers||{}))if(['openai-completions','openai-responses'].includes(provider.api)&&provider.agentRuntime?.id!=='openclaw')throw new Error(name+': Flolah native plugin tools require agentRuntime=openclaw');
}
console.log('OpenClaw seed IDs and tool/plugin policy shapes validated: '+seeds.length);
