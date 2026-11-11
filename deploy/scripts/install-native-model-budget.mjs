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
 if(!source.includes('streamFn = wrapFlolahModelEgress(streamFn);')) {
  if(source.split(anchor).length!==2)throw Error('Unsupported OpenClaw model egress ABI: '+file);
  source="import {wrapFlolahModelEgress} from './flolah-model-egress.js';\n"+source.replace(anchor,anchor+'\n\tstreamFn = wrapFlolahModelEgress(streamFn);');
 }
 if(source.includes('streamFn = wrapFlolahBudgetStream(streamFn, ctx);')){writeFileSync(path,source);continue;}
 if(source.split(anchor).length!==2||!source.includes('const result = streamFn(model, streamContext, lifecycle.propagatedOptions);'))throw Error('Unsupported OpenClaw model submission ABI: '+file);
 source="import {wrapFlolahBudgetStream} from './flolah-model-budget.js';\n"+source.replace(anchor,anchor+'\n\tstreamFn = wrapFlolahBudgetStream(streamFn, ctx);');
 writeFileSync(path,source);
}
copyFileSync(join(root,'openclaw-extensions/agent-os-content-tools/model-budget-transport.js'),join(dist,'flolah-model-budget.js'));
copyFileSync(join(root,'scripts/lib/model-egress.js'),join(dist,'flolah-model-egress-core.js'));
writeFileSync(join(dist,'flolah-model-egress.js'),readFileSync(join(root,'openclaw-extensions/agent-os-content-tools/model-egress-transport.js'),'utf8').replace('../../scripts/lib/model-egress.js','./flolah-model-egress-core.js'));
console.log('NATIVE_MODEL_BUDGET_INSTALLED: '+files.length+' submission module(s)');
