// Verify shipped help content and actual platform-only RAG retrieval. This does
// not read CEO documents, call a model or issue a workflow/browser command.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {resolvePlatformHelpDir} from '../src/services/ceo-default-master-data.js';
import {listPublicGuideSources} from '../src/services/opensearch/platform-docs.js';
import {listDocuments,searchDocuments} from '../src/services/opensearch/documents.js';
import {PLATFORM_OWNER_ID} from '../src/services/opensearch/indices.js';
const page=await listDocuments(PLATFORM_OWNER_ID,{limit:200,offset:0}),documents=Array.isArray(page)?page:page.documents||[],root=resolvePlatformHelpDir();
const curated=['61-platform-help-ui-copilot.md','62-copilot-coaching.md','63-copilot-platform-map.md','64-digital-adoption-websites.md','65-copilot-workflow-connectors.md'].map(filename=>({filename:'platform-help-'+filename,content:readFileSync(join(root,filename),'utf8')}));
const publicSources=listPublicGuideSources().filter(s=>['Platform Help copilot','Website copilot workflow connectors','Digital Adoption website copilots'].some(title=>s.title.endsWith(title)));
assert.equal(publicSources.length,3,'The three public copilot guides must ship in the backend corpus');
const verified=[];
for(const source of [...curated,...publicSources]){
 const matches=documents.filter(d=>d.filename===source.filename);assert.equal(matches.length,1,'Expected one indexed document: '+source.filename);
 const expected=createHash('sha256').update(source.content,'utf8').digest('hex');assert.equal(matches[0].content_sha256,expected,'Stale indexed content: '+source.filename);verified.push({filename:source.filename,sha256:expected});
}
const result=await searchDocuments(PLATFORM_OWNER_ID,{query:'persistent workflow target group one-use authorization code expiry',topK:6});
assert.ok(result.chunks.some(c=>/65-copilot-workflow|copilot-workflows/.test(c.filename)),'New workflow-target guidance must be retrievable');
const mapContext=await searchDocuments(PLATFORM_OWNER_ID,{query:'Download website map JSON Edit page form field descriptions',topK:6});
assert.ok(mapContext.chunks.some(c=>/64-digital-adoption|systems--digital-adoption/.test(c.filename)&&/description/i.test(c.text||c.content||'')),'Map description guidance must be retrievable');
console.log(JSON.stringify({status:'passed',verified,retrieved:[...result.chunks,...mapContext.chunks].map(c=>({filename:c.filename,title:c.title})),mapContextRetrievable:true,scope:'platform help only; no model or visitor action'},null,2));
