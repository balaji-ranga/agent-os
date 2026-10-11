import {permittedKnowledgeSources} from './knowledge-agent-access.js';
import {knowledgeStore} from './knowledge-store.js';
import {connectedKnowledge} from './knowledge-runtime.js';
import {assertKnowledgeSourceAccess} from './knowledge-source-adapters.js';
import {sourceReadable} from './knowledge-selection.js';

// Ordinary agent RAG reads the same filtered/projected published copies as
// connected RAG. A source grant must never unlock the unfiltered raw corpus.
export async function grantedDocumentRag(owner,agentId,{query,documentId=null,source_ids=null,topK=5}={},deps={}) {
  const permit=deps.permit||permittedKnowledgeSources,store=deps.store||knowledgeStore();
  const granted=permit(owner,agentId,source_ids);
  const sources=store.list(owner).filter(s=>granted.includes(s.id)&&s.kind==='knowledge'&&s.collections.includes('documents')&&sourceReadable(s));
  const empty=code=>({chunks:[],hit_count:0,access_status:code});
  if(!granted.length)return empty('no_knowledge_sources_granted');
  if(!sources.length)return empty('no_visible_indexed_document_sources');
  if(process.env.KNOWLEDGE_SYNC_ENABLED!=='1')return empty('connected_knowledge_disabled');
  if(documentId!==null&&(typeof documentId!=='string'||!documentId||documentId.length>300||/[\/\\]/.test(documentId)))throw Object.assign(new Error('Invalid document ID'),{status:400});
  const result=await (deps.retrieve||connectedKnowledge)(owner,{query,depth:0,source_ids:sources.map(s=>s.id),document_scope:{id:documentId}}, {
    assertAccess:async (currentOwner,source)=>{permit(currentOwner,agentId,[source.id]);await (deps.assertAccess||assertKnowledgeSourceAccess)(currentOwner,source);},
  });
  const chunks=result.chunks.slice(0,Math.min(20,Math.max(1,Number(topK)||5))).map(c=>({...c,content:c.text,document_id:c.object_id.split('/')[1]}));
  const recheck=async()=>{for(const source of sources){
    permit(owner,agentId,[source.id]);
    const latest=store.list(owner).find(s=>s.id===source.id);
    if(!sourceReadable(latest)||latest.revision!==source.revision)throw Object.assign(new Error('Knowledge source access or revision changed; retry retrieval'),{status:403,code:'knowledge_access_changed'});
    await (deps.assertAccess||assertKnowledgeSourceAccess)(owner,latest);
  }};
  return {chunks,hit_count:chunks.length,access_status:'granted',sources:result.sources,recheck};
}
