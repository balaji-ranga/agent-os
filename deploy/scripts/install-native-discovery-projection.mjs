import {readFileSync,readdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist',repo=process.argv[3]||'/opt/agent-os';
const before='messages: Array.isArray(transformed) ? transformed : messages,\n\t\t\tmaxSingleToolResultChars';
const after='messages: flolahProjectDiscoveryMessages(Array.isArray(transformed) ? transformed : messages),\n\t\t\tmaxSingleToolResultChars';
const compactionBefore='\t\tidentifierSectionInstruction,\n\t\t"Do not omit unresolved asks from the user.",';
const compactionAfter='\t\tidentifierSectionInstruction,\n\t\tflolahIncrementalCompactionInstruction,\n\t\t"Do not omit unresolved asks from the user.",';
let count=0;
for(const file of readdirSync(root).filter(f=>/^builtin-openclaw-.*\.js$/.test(f))){
 const path=join(root,file);let source=readFileSync(path,'utf8');
 if(!source.includes(before)&&!source.includes(after))continue;
 if(!source.includes(after)){
  if(source.split(before).length!==2)throw Error('Ambiguous model projection ABI');
  source="import {projectDiscoveryMessages as flolahProjectDiscoveryMessages} from './flolah-discovery-projection.js';\n"+source.replace(before,after);
 }
 if(!source.includes(compactionAfter)){
  if(source.split(compactionBefore).length!==2)throw Error('Unsupported compaction checkpoint ABI');
  source="import {incrementalCompactionInstruction as flolahIncrementalCompactionInstruction} from './flolah-context-budget-guidance.js';\n"+source.replace(compactionBefore,compactionAfter);
 }
 writeFileSync(path,source);count++;
}
if(count!==1)throw Error(`Unsupported model projection ABI: ${count}`);
copyFileSync(join(repo,'openclaw-extensions/agent-os-content-tools/discovery-projection.js'),join(root,'flolah-discovery-projection.js'));
copyFileSync(join(repo,'openclaw-extensions/agent-os-content-tools/context-budget-guidance.js'),join(root,'flolah-context-budget-guidance.js'));
console.log('NATIVE_DISCOVERY_PROJECTION_INSTALLED');
