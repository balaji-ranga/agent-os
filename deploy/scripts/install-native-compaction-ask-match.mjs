// Keep stop-word-only user turns auditable after compaction. The native ask
// tokenizer falls back to lexical tokens for "Hi", while a longer summary's
// keyword tokenizer removes it. Match against both representations, not a
// substring, and retain all other summary/identifier/pending-request guards.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist';
const before='const summaryTokens = new Set(tokenizeAskOverlapText(summary));';
const after=`// Flolah: symmetric lexical fallback for stop-word-only asks.
\tconst lexicalSummaryTokens = localeLowercasePreservingWhitespace(summary.normalize("NFKC")).split(/[^\\p{L}\\p{N}]+/u).filter(Boolean);
\tconst summaryTokens = new Set([...tokenizeAskOverlapText(summary), ...lexicalSummaryTokens]);`;
const paths=readdirSync(root).filter(n=>/^builtin-openclaw-.*\.js$/.test(n)).map(n=>join(root,n));
paths.push(join(root,'worker','worker.mjs'));
const changes=[];
for(const path of paths){
 const source=readFileSync(path,'utf8');
 const worker=path.endsWith('worker.mjs');
 const from=worker?'let Dn=new Set(tokenizeAskOverlapText(Ot));':before;
 const to=worker?'let Dn=new Set([...tokenizeAskOverlapText(Ot),...localeLowercasePreservingWhitespace(Ot.normalize("NFKC")).split(/[^\\p{L}\\p{N}]+/u).filter(Boolean)]);':after;
 if(source.includes(to)){changes.push({path,source,done:true});continue;}
 const count=source.split(from).length-1;
 if(count===0)continue;
 if(count!==1)throw Error('Ambiguous compaction ask matcher: '+path);
 changes.push({path,source:source.replace(from,to)});
}
if(changes.length!==2)throw Error('Unsupported compaction ask matcher ABI; expected runtime and worker');
for(const c of changes)if(!c.done)writeFileSync(c.path,c.source);
console.log('NATIVE_COMPACTION_ASK_MATCH_OK: runtime and worker');
