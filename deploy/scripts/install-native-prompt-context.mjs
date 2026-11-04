// Preserve prompt-hook system context at the native assembly/submission boundary.
// Pinned ABI: fail closed if the installed runtime changes this call-site shape.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';
const before='\t\t\t\tsystemPromptText: sessionRuntimeState.systemPromptText,\n\t\t\t\ttoolResultPromptProjectionState';
const after='\t\t\t\tget systemPromptText() { return sessionRuntimeState.systemPromptText; },\n\t\t\t\ttoolResultPromptProjectionState';
let count=0;
for(const name of readdirSync(root).filter(n=>/^builtin-openclaw-.*\.js$/.test(n))){
 const path=join(root,name),source=readFileSync(path,'utf8');
 if(source.includes(after)){count++;continue;}
 const matches=source.split(before).length-1;
 if(matches===0)continue;
 if(matches!==1)throw Error('Ambiguous native prompt context call site');
 writeFileSync(path,source.replace(before,after));count++;
}
if(count!==1)throw Error('Unsupported native prompt submission ABI');
console.log('NATIVE_PROMPT_CONTEXT_LIVE_STATE_OK');
