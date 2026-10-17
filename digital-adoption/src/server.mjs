import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { validateSnapshot } from './proposals.mjs';
import {createRequestBudget} from './request-budget.mjs';
import {constrainNavigation} from './navigation-intent.mjs';
import {constrainEdit} from './edit-intent.mjs';

const assets = new Map([
  ['/owner.html', ['../web/manage.html', 'text/html']],
  ['/manage.html', ['../web/manage.html', 'text/html']],
  ['/manage.mjs', ['../web/manage.mjs', 'text/javascript']],
  ['/sdk.mjs', ['../web/sdk.mjs', 'text/javascript']],
  ['/theme.mjs', ['../web/theme.mjs', 'text/javascript']],
  ['/session-client.mjs', ['../web/session-client.mjs', 'text/javascript']],
  ['/dom.mjs', ['../web/dom.mjs', 'text/javascript']],
  ['/recording.mjs', ['../web/recording.mjs', 'text/javascript']],
  ['/files.mjs', ['../web/files.mjs', 'text/javascript']],
  ['/screen-capture.mjs', ['../web/screen-capture.mjs', 'text/javascript']],
  ['/widget.html', ['../web/widget.html', 'text/html']],
  ['/widget.mjs', ['../web/widget.mjs', 'text/javascript']],
]);
async function body(req,limit=32_768) {
  const chunks=[];let size=0;
  for await (const chunk of req) {
    size+=chunk.length;if(size>limit)throw new Error('Request too large');chunks.push(chunk);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Invalid request');
  return parsed;
}

export function createAdoptionServer({ authority, proposals, planner, knowledge, ingestion, answer, management, ownerIdentity, ownerManagement, platformOrigin, development = false, fixture = null }) {
  const budget=createRequestBudget();
  let activeUploads=0;
  return createServer(async (req, res) => {
    let uploadSlot=false;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const path = new URL(req.url, 'http://unused').pathname;
    try {
      if (req.method === 'GET' && path === '/health') return send(200, { service: 'digital-adoption', status: 'ok', releaseReady: false });
      if (req.method === 'GET' && assets.has(path)) {
        res.setHeader('Access-Control-Allow-Origin','*'); // Public SDK assets only; API authorization is separate.
        const [file, type] = assets.get(path);
        res.setHeader('Content-Security-Policy', ['/manage.html','/owner.html'].includes(path)?"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'":"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; media-src blob:; frame-ancestors *; base-uri 'none'; form-action 'none'");
        res.writeHead(200, { 'Content-Type': type });
        return res.end(await readFile(new URL(file, import.meta.url)));
      }
      if (development && fixture && req.method === 'GET' && path === '/fixture') {
        res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fixture);
      }
      if (development && fixture && req.method === 'GET' && path === '/fixture/destination') {
        res.writeHead(200, {'Content-Type':'text/html'});
        return res.end('<!doctype html><html lang="en"><title>Recorded destination</title><h1>Recorded navigation reached its destination</h1><p>No form was submitted.</p><a href="/fixture">Return to harness</a></html>');
      }
      // Actual request Origin is used; no user-supplied embedding/session IDs select scope.
      const origin = req.headers.origin;
      if (typeof origin !== 'string' || origin === 'null') return send(403, { error: 'Access denied' });
      if (req.method === 'OPTIONS') {
        // CORS is not authentication; POST still validates the installation/session.
        res.writeHead(204, { 'Access-Control-Allow-Origin': origin, Vary: 'Origin',
          'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '60' }); return res.end();
      }
      if (req.method !== 'POST') return send(404, { error: 'Not found' });
      if (!(req.headers['content-type'] || '').startsWith('application/json')) return send(415, { error: 'JSON required' });
      const fileUpload=['/v1/manage/source-file','/v1/owner/manage/source-file','/v1/knowledge/upload'].includes(path);
      if(fileUpload){
        budget.take(`upload:${req.socket.remoteAddress}`,5);
        // Authorize before buffering a large file. Resource ownership is checked
        // again after parsing, before it reaches raw storage or a worker.
        if(path==='/v1/manage/source-file'){if(!management)throw new Error('Management unavailable');await management({authorization:req.headers.authorization,origin,path:'/v1/manage/websites',input:{}});}
        else if(path==='/v1/owner/manage/source-file'){if(!ownerManagement||origin!==platformOrigin)throw new Error('Owner access denied');await ownerManagement({authorization:req.headers.cookie,origin,path:'/v1/manage/websites',input:{}});}
        else {const sessionToken=/^Bearer (\S+)$/.exec(req.headers.authorization||'')?.[1];if(!authority.context({sessionToken,origin}).capabilities.upload)throw new Error('Uploads disabled');}
        if(activeUploads>=2)throw new Error('Request capacity reached');activeUploads++;uploadSlot=true;
      }
      const input = await body(req,fileUpload?23_000_000:32_768);
      let result;
      if(path.startsWith('/v1/owner/')){
        if(!ownerIdentity||origin!==platformOrigin)return send(403,{error:'Access denied'});
        budget.take(`owner:${req.socket.remoteAddress}`,30);
        if(path==='/v1/owner/start')result=await ownerIdentity.start(input.email);
        else if(path==='/v1/owner/confirm'){const login=ownerIdentity.confirm(input.email,input.challenge,input.code);res.setHeader('Set-Cookie',login.cookie);result={signedIn:true};}
        else if(path==='/v1/owner/logout'){res.setHeader('Set-Cookie',ownerIdentity.logout(req.headers.cookie).cookie);result={signedOut:true};}
        else if(path.startsWith('/v1/owner/manage/'))result=await ownerManagement({authorization:req.headers.cookie,origin,path:path.replace('/v1/owner/manage/','/v1/manage/'),input});
        else return send(404,{error:'Not found'});
        return send(200,result);
      }
      if(path.startsWith('/v1/manage/')){
        if(!management)return send(403,{error:'Management unavailable'});
        budget.take(`management:${req.socket.remoteAddress}`,60);
        result=await management({authorization:req.headers.authorization,origin,path,input});
        return send(200,result);
      }
      if (path === '/v1/sessions') {budget.take(`init:${req.socket.remoteAddress}`,60);result = authority.initialize({ installationToken: input.installationToken, origin, initializationKey:input.initializationKey });}
      else {
        const sessionToken = /^Bearer (\S+)$/.exec(req.headers.authorization || '')?.[1];
        const auth = { sessionToken, origin };
        const scope = authority.context(auth);
        if (path === '/v1/history') result = { messages: authority.history(auth) };
        else if(path==='/v1/capabilities')result={capabilities:scope.capabilities};
        else if(path==='/v1/history/clear')result=authority.clearConversation(auth);
        else if(path==='/v1/knowledge/documents'){if(!knowledge)throw new Error('Knowledge unavailable');result={sources:knowledge.available(scope)};}
        else if(path==='/v1/knowledge/upload'){
          if(!ingestion||!scope.capabilities.upload)throw new Error('Uploads disabled');
          authority.touch(auth);result=await ingestion.upload({...scope,role:'maintainer'},input);
          authority.context(auth); // Revocation while storage was in progress is not a successful response.
        }
        else if(path==='/v1/knowledge/upload-status'){if(!ingestion)throw new Error('Ingestion unavailable');result=ingestion.status(scope,input.sourceId);}
        else if (path === '/v1/messages') result = authority.appendMessage({ ...auth, text: input.text, replyTo: input.replyTo });
        else if (path === '/v1/renew') result = authority.renew(auth);
        else if (path === '/v1/terminate') { authority.terminate(auth); result = { terminated: true }; }
        else if (path === '/v1/plan') {
          budget.take(`model:${scope.embeddingId}`);
          if (!planner || !proposals) return send(503,{ error:'Model assistance is not configured' });
          if (typeof input.text !== 'string' || !input.text.trim() || input.text.length > 8000) throw new Error('Invalid request');
          const snapshot=constrainEdit(input.text,constrainNavigation(input.text,validateSnapshot(input.snapshot)));
          authority.touch(auth);
          authority.appendMessage({...auth,text:input.text,replyTo:input.replyTo??null});
          // No credentials or caller-provided identity are passed to the model.
          const guideHistory=authority.history(auth).filter(m=>(m.channel||'guide')==='guide');
          const response=await planner({ text:input.text,snapshot,history:guideHistory.slice(-12),replyContext:guideHistory.find(m=>m.id===input.replyTo)?.text });
          if(authority.context(auth).conversationVersion!==scope.conversationVersion)throw new Error('Conversation cleared; response discarded');
          result=proposals.prepare(scope,snapshot,response);
          result.messageId=authority.appendAssistant(auth,result.message).id;
        }
        else if(path==='/v1/knowledge/search'||path==='/v1/ask') {
          budget.take(`${path==='/v1/ask'?'model':'search'}:${scope.embeddingId}`);
          if(!knowledge)return send(503,{error:'Knowledge is not configured'});
          if(typeof input.text!=='string'||!input.text.trim()||input.text.length>2000)throw new Error('Invalid query');
          const retrieved=await knowledge.retrieve(scope,{query:input.text,size:6});
          if(authority.context(auth).conversationVersion!==scope.conversationVersion)throw new Error('Conversation cleared; request discarded');
          if(path==='/v1/knowledge/search')result=retrieved;
          else {
            if(!answer)return send(503,{error:'Knowledge model is not configured'});
            authority.appendMessage({...auth,text:input.text,channel:'knowledge',replyTo:input.replyTo??null});
            const knowledgeHistory=authority.history(auth).filter(m=>m.channel==='knowledge');
            result=await answer({text:input.text,evidence:retrieved.evidence,history:knowledgeHistory,replyContext:knowledgeHistory.find(m=>m.id===input.replyTo)?.text});
            if(authority.context(auth).conversationVersion!==scope.conversationVersion)throw new Error('Conversation cleared; response discarded');
            // Source deletion during inference must invalidate its citations.
            const current=await knowledge.retrieve(scope,{query:input.text,size:6});
            if(authority.context(auth).conversationVersion!==scope.conversationVersion)throw new Error('Conversation cleared; response discarded');
            if(result.citations.some(c=>!current.evidence.some(e=>e.chunkId===c.chunkId&&e.revision===c.revision)))throw new Error('Evidence changed');
            result.messageId=authority.appendAssistant(auth,result.message,'knowledge').id;
          }
        }
        else if (path === '/v1/approve') {
          if (!proposals) return send(503,{ error:'Action review is not configured' });
          result=proposals.consume(scope,{ id:input.id,revision:input.revision,approved:input.approved });
          authority.touch(auth);
        }
        else return send(404, { error: 'Not found' });
      }
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      return send(200, result);
    } catch (error) {
      const code = error.message === 'Request too large' ? 413 : error.message==='Request rate exceeded'||error.message==='Request capacity reached'?429:403;
      return send(code, { error: code === 413 ? 'Request too large' : 'Access denied or invalid request' });
    }finally{if(uploadSlot)activeUploads--;}
  });
}
