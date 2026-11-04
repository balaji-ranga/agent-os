import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';import {join} from 'node:path';
const dist=process.argv[2]||'/usr/local/lib/node_modules/openclaw/dist',root=process.argv[3]||'/opt/agent-os';
const path=join(dist,'extensions/memory-core/manager-runtime.js');let s=readFileSync(path,'utf8');
const marker="import {prepareMemoryDelta} from '../../flolah-memory-delta.js';";
if(!s.includes(marker)){
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
copyFileSync(join(root,'openclaw-extensions/agent-os-content-tools/memory-delta.js'),join(dist,'flolah-memory-delta.js'));console.log('MEMORY_DELTA_INSTALLED');
