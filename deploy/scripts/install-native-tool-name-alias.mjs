// Normalize conventional namespace syntax using exact visible catalog IDs. Resolve
// against the SAME visible catalog, preserving exact IDs, ambiguity, allowedIds,
// MCP filtering and the caller's normal argument validation/execution path.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';
const before='\tif (exactIdEntry) return exactIdEntry;\n\tconst namedEntries = entries.filter((candidate) => candidate.name === needle);';
const legacyAfter='\tif (exactIdEntry) return exactIdEntry;\n\t// Flolah tool namespace compatibility; never fuzzy-match or bypass visibility.\n\tif (/^functions\\.[A-Za-z0-9_-]+$/.test(needle) && !entries.some(candidate => candidate.name === needle)) return findEntry(catalog, needle.slice(10), options, errorOptions);\n\tconst namedEntries = entries.filter((candidate) => candidate.name === needle);';
const workerBefore='if(Fn)return Fn;let Ln=Pn.filter(Ot=>Ot.name===kn);';
const legacyWorkerAfter='if(Fn)return Fn;if(/^functions\\.[A-Za-z0-9_-]+$/.test(kn)&&!Pn.some(Ot=>Ot.name===kn))return findEntry(Ot,kn.slice(10),_n,Dn);let Ln=Pn.filter(Ot=>Ot.name===kn);';
const after=legacyAfter.replace('\tconst namedEntries',String.raw`\tconst flolahAliases = entries.filter(candidate => /^(?:openclaw|mcp):/.test(candidate.id) && candidate.id.replace(/:([^:]+)$/, '.$1') === needle);
\tif (!entries.some(candidate => candidate.name === needle)) {
\t  if (flolahAliases.length > 1) throw new ToolInputError('Ambiguous tool alias; use an exact tool id.');
\t  if (flolahAliases.length === 1) return flolahAliases[0];
\t}
\tconst namedEntries`.replaceAll('\\t','\t'));
const workerAfter=legacyWorkerAfter.replace('let Ln=',String.raw`let flolahAliases=Pn.filter(e=>/^(?:openclaw|mcp):/.test(e.id)&&e.id.replace(/:([^:]+)$/,'.$1')===kn);if(!Pn.some(e=>e.name===kn)){if(flolahAliases.length>1)throw new ToolInputError('Ambiguous tool alias; use an exact tool id.');if(flolahAliases.length===1)return flolahAliases[0];}let Ln=`);
const paths=readdirSync(root).filter(n=>/^local-model-lean-.*\.js$/.test(n)).map(n=>join(root,n));paths.push(join(root,'worker','worker.mjs'));
const changes=[];
for(const path of paths){const source=readFileSync(path,'utf8'),worker=path.endsWith('worker.mjs'),legacy=worker?legacyWorkerAfter:legacyAfter,from=source.includes(legacy)?legacy:(worker?workerBefore:before),to=worker?workerAfter:after;
 if(source.includes(to)){changes.push({path,source,done:true});continue;}
 const n=source.split(from).length-1;if(!n)continue;if(n!==1)throw Error('Ambiguous native tool resolver ABI');changes.push({path,source:source.replace(from,to)});
}
if(changes.length!==2)throw Error('Unsupported native tool resolver ABI; expected runtime and worker');
for(const c of changes)if(!c.done)writeFileSync(c.path,c.source);
console.log('NATIVE_TOOL_NAME_ALIAS_OK');
