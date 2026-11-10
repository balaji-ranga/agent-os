import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';
const files=readdirSync(root);
const compactions=files.filter(f=>/^compaction-.*\.js$/.test(f)).map(file=>({file,source:readFileSync(join(root,file),'utf8')})).filter(x=>x.source.includes('function* iterateSessionContextEntries('));
if(compactions.length!==1)throw Error('Unsupported context-window ABI');
const alias=compactions[0].source.match(/iterateSessionContextEntries as (\w+)/)?.[1];
if(!alias)throw Error('Missing native context iterator export');
let count=0;
for(const file of files.filter(f=>/^tool-result-truncation-.*\.js$/.test(f))){
 const path=join(root,file);let source=readFileSync(path,'utf8');
 if(source.includes('flolahRecoveryContextIds')){count++;continue;}
 const anchor='function truncateOversizedToolResultsInExistingSessionManager(params) {\n\tconst { sessionManager, contextWindowTokens } = params;\n\tconst branch = sessionManager.getBranch();';
 if(!source.includes(anchor))continue;
 source=`import { ${alias} as flolahIterateRecoveryContext } from "./${compactions[0].file}";\n`+source.replace(anchor,`function truncateOversizedToolResultsInExistingSessionManager(params) {
\tconst { sessionManager, contextWindowTokens } = params;
\tconst fullBranch = sessionManager.getBranch();
\t// Archived tool results cannot overflow the current model context. Rewriting
\t// them needlessly replays the entire historical suffix into durable storage.
\tconst flolahRecoveryContextIds = new Set(Array.from(flolahIterateRecoveryContext(fullBranch), ({entry}) => entry.id));
\tconst branch = fullBranch.filter(entry => flolahRecoveryContextIds.has(entry.id));`);
 writeFileSync(path,source);count++;
}
if(count!==1)throw Error(`Unsupported recovery ABI: ${count}`);
console.log('RECOVERY_CONTEXT_WINDOW_INSTALLED');
