import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';import {join} from 'node:path';
const dist=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist',root=process.argv[3]||'/opt/agent-os';
const path=join(dist,'extensions/memory-core/manager-runtime.js');let s=readFileSync(path,'utf8');
const marker="import {prepareMemoryDelta} from '../../flolah-memory-delta.js';";
if(!s.includes(marker)&&!s.includes("import {prepareMemoryDelta,assertRetentionSnapshot} from '../../flolah-memory-delta.js';")){
 const start=s.indexOf('\tasync writeChunks('),end=s.indexOf('\n\tasync prepareIndexEntry(',start);if(start<0||end<0)throw Error('Unsupported memory writer ABI');
 let body=s.slice(start,end);
 const anchors=['this.clearIndexedFileData(entry.path, source);','if (vectorReady && embedding.length > 0) replaceMemoryVectorRow({','if (this.fts.enabled && this.fts.available) this.db.prepare(`INSERT INTO ${FTS_TABLE$2}'];
 for(const a of anchors)if(body.split(a).length!==2)throw Error('Unsupported memory writer anchor: '+a);
 body=body.replace(anchors[0],`const delta = prepareMemoryDelta({db:this.db,path:entry.path,source,entries:chunks.map((chunk,i)=>({id:hashText(\x60\x24{source}:\x24{entry.path}:\x24{chunk.startLine}:\x24{chunk.endLine}:\x24{chunk.hash}:\x24{model}\x60),embedding:embeddings[i]??[]})),vectorTable:VECTOR_TABLE$1,ftsTable:FTS_TABLE$2,vectorReady,ftsReady:this.fts.enabled && this.fts.available});
                if (!delta) this.clearIndexedFileData(entry.path, source);`);
 body=body.replace(anchors[1],'if (vectorReady && embedding.length > 0 && !delta?.vectorUnchanged(id, embedding)) replaceMemoryVectorRow({');
 body=body.replace(anchors[2],'if (this.fts.enabled && this.fts.available && !delta?.ftsUnchanged(id, chunk, model)) this.db.prepare(`INSERT INTO ${FTS_TABLE$2}');
 s=marker+'\n'+s.slice(0,start)+body+s.slice(end);writeFileSync(path,s);
}
// Prepare the three invariant metadata statements once per reconciliation,
// retaining every native metadata/timestamp write and the atomic transaction.
s=readFileSync(path,'utf8');
if(!s.includes('const flolahChunkStatement =')){
 const start=s.indexOf('\tasync writeChunks('),end=s.indexOf('\n\tasync prepareIndexEntry(',start);
 if(start<0||end<0)throw Error('Unsupported prepared writer ABI');
 let body=s.slice(start,end),declarations=[];
 for(const [table,name]of [['memory_index_chunks','flolahChunkStatement'],['${MEMORY_INDEX_CHUNK_RECALL_METADATA_TABLE}','flolahRecallStatement'],['${MEMORY_INDEX_CHUNK_PROVENANCE_TABLE}','flolahProvenanceStatement']]){
  const begin=body.indexOf('this.db.prepare(`INSERT INTO '+table+' ');
  const stop=body.indexOf('`).run(',begin);
  if(begin<0||stop<0)throw Error('Unsupported native statement: '+table);
  const expression=body.slice(begin,stop+2);
  declarations.push('const '+name+' = '+expression+';');
  body=body.slice(0,begin)+name+body.slice(stop+2);
 }
 const anchor='runSqliteImmediateTransactionSync(this.db, () => {';
 if(body.split(anchor).length!==2)throw Error('Unsupported transaction anchor');
 body=body.replace(anchor,anchor+'\n'+declarations.join('\n'));
 const jsonAnchor='chunk.text, JSON.stringify(embedding), now';
 if(body.split(jsonAnchor).length!==2)throw Error('Unsupported embedding serialization ABI');
 body=body.replace(jsonAnchor,'chunk.text, delta ? delta.embeddingJson(embedding) : JSON.stringify(embedding), now');
 s=s.slice(0,start)+body+s.slice(end);writeFileSync(path,s);
}
s=readFileSync(path,'utf8');
if(!s.includes('assertRetentionSnapshot(this.db, entry);')){
 const anchor='const sessionId = expectDefined(entry.sessionId, "memory index session identity");';
 if(s.split(anchor).length!==2||!s.includes(marker))throw Error('Unsupported native retention fence ABI');
 s=s.replace(marker,"import {prepareMemoryDelta,assertRetentionSnapshot} from '../../flolah-memory-delta.js';").replace(anchor,anchor+'\nassertRetentionSnapshot(this.db, entry);');writeFileSync(path,s);
}
copyFileSync(join(root,'openclaw-extensions/agent-os-content-tools/memory-delta.js'),join(dist,'flolah-memory-delta.js'));console.log('MEMORY_DELTA_INSTALLED');
