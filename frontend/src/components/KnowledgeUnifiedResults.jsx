import KnowledgeSearchResults from './KnowledgeSearchResults.jsx';
import {renderChatMarkdown} from '../utils/chatMarkdown.js';

export default function KnowledgeUnifiedResults({result}){
  return <div>
    {result.errors.map(error=><p key={error} role="alert" className="knowledge-alert knowledge-alert-error">Partial results — {error}</p>)}
    {result.mode==='auto'&&<p>Auto searches documents and connected sources. Each answer keeps its own evidence and citations; relationships are shown only where established.</p>}
    {result.connected&&<section aria-label="Connected search results"><h3>Connected sources</h3><KnowledgeSearchResults result={result.connected}/></section>}
    {result.documents&&<section aria-label="Document search results"><h3>Documents ({result.documents.hit_count||0} matching excerpts)</h3>
      {result.documents.summary&&<div className="chat-message-md">{renderChatMarkdown(result.documents.summary)}</div>}
      {!result.documents.chunks?.length&&<p>No relevant document excerpts found.</p>}
      {(result.documents.chunks||[]).map((chunk,i)=><details key={`${chunk.document_id}:${chunk.chunk_index}:${i}`}><summary>[{i+1}] {chunk.title||chunk.filename||chunk.document_id}</summary><pre style={{whiteSpace:'pre-wrap'}}>{chunk.content}</pre><small>Document: {chunk.document_id} · Chunk: {chunk.chunk_index}</small></details>)}
      <small>Up to 20 relevance-ranked excerpts per search. Narrow your question for more specific results.</small>
    </section>}
  </div>;
}
