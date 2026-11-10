import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';import {join} from 'node:path';
const dist=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist',repo=process.argv[3]||'/opt/agent-os';
const path=join(dist,'extensions/memory-core/manager-runtime.js');let s=readFileSync(path,'utf8');
if(!s.includes('flolahUnchangedEmbeddingStatement')){
 const start=s.indexOf('function upsertMemoryEmbeddingCache(params) {'),end=s.indexOf('\nfunction collectMemoryCachedEmbeddings(',start);
 if(start<0||end<0)throw Error('Unsupported cache writer ABI');
 const body=s.slice(start,end),loop='for (const entry of params.entries) {';
 if(body.split(loop).length!==2)throw Error('Unsupported cache upsert loop');
 s=s.slice(0,start)+body.replace(loop,'for (const entry of uniqueMemoryCacheEntries(params.entries)) {')+s.slice(end);
 const declaration='const flolahRecallStatement = this.db.prepare(';
 const run='flolahChunkStatement.run(id, entry.path, source, chunk.startLine, chunk.endLine, chunk.hash, model, chunk.text, delta ? delta.embeddingJson(embedding) : JSON.stringify(embedding), now);';
 for(const anchor of [declaration,run])if(s.split(anchor).length!==2)throw Error('Unsupported delta writer ABI');
 s="import {uniqueMemoryCacheEntries} from '../../flolah-memory-delta.js';\n"+s.replace(declaration,"const flolahUnchangedEmbeddingStatement = this.db.prepare('UPDATE memory_index_chunks SET hash=?, model=?, text=?, updated_at=? WHERE id=?');\n"+declaration)
 .replace(run,'if (delta?.embeddingUnchanged(id, embedding)) flolahUnchangedEmbeddingStatement.run(chunk.hash, model, chunk.text, now, id);\nelse '+run);
 writeFileSync(path,s);
}
copyFileSync(join(repo,'openclaw-extensions/agent-os-content-tools/memory-delta.js'),join(dist,'flolah-memory-delta.js'));
console.log('MEMORY_HEAP_BOUNDED_COMPARISON_INSTALLED');
