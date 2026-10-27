// Reproducible pinned-runtime adaptation, applied in both gateway Docker builds.
// Refuse an unknown stream ABI instead of shipping a silently bypassed budget.
import {readFileSync,readdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const dist=resolve(process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist');
const root=resolve(process.argv[3]||'/opt/agent-os');
const files=readdirSync(dist).filter(name=>/^attempt\.model-diagnostic-events-.*\.js$/.test(name));
if(!files.length)throw Error('Unsupported OpenClaw model submission ABI: no diagnostic stream wrapper.');
const anchor='function wrapStreamFnWithDiagnosticModelCallEvents(streamFn, ctx) {';
for(const file of files){
 const path=join(dist,file);let source=readFileSync(path,'utf8');
 if(source.includes('streamFn = wrapFlolahBudgetStream(streamFn, ctx);'))continue;
 if(source.split(anchor).length!==2||!source.includes('const result = streamFn(model, streamContext, lifecycle.propagatedOptions);'))throw Error('Unsupported OpenClaw model submission ABI: '+file);
 source="import {wrapFlolahBudgetStream} from './flolah-model-budget.js';\n"+source.replace(anchor,anchor+'\n\tstreamFn = wrapFlolahBudgetStream(streamFn, ctx);');
 writeFileSync(path,source);
}
copyFileSync(join(root,'openclaw-extensions/agent-os-content-tools/model-budget-transport.js'),join(dist,'flolah-model-budget.js'));
console.log('NATIVE_MODEL_BUDGET_INSTALLED: '+files.length+' submission module(s)');
