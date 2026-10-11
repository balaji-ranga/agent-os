import KnowledgeSearchResults from './KnowledgeSearchResults.jsx';
import KnowledgeDocumentResults from './KnowledgeDocumentResults.jsx';
import {renderChatMarkdown} from '../utils/chatMarkdown.js';

export default function KnowledgeUnifiedResults({result}){
  return <div>
    {result.errors.map(error=><p key={error} role="alert" className="knowledge-alert knowledge-alert-error">Partial results — {error}</p>)}
    {result.mode==='auto'&&<p>Auto searches documents and connected sources. Each answer keeps its own evidence and citations; relationships are shown only where established.</p>}
    {result.connected&&<section aria-label="Connected search results"><h3>Connected sources</h3><KnowledgeSearchResults result={result.connected}/></section>}
    {result.documents&&<section aria-label="Document search results"><h3>Documents ({result.documents.hit_count||0} matching excerpts)</h3>
      {result.documents.summary&&<div className="chat-message-md">{renderChatMarkdown(result.documents.summary)}</div>}
      <KnowledgeDocumentResults key={result.documents.page_token||result.documents.query} result={result.documents}/>
    </section>}
  </div>;
}
