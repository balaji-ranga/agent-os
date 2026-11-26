import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
const turns=new Map();
const message=m=>m?.message||m;
const text=m=>typeof m?.content==='string'?m.content:(m?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');
export async function nativeReplyTarget(sessionKey,transport){
 const agent=String(sessionKey||'').match(/^agent::?([a-zA-Z0-9_-]+):/)?.[1];
 if(!agent||!transport?.replyToId||!transport.conversationRef||!transport.accountId)return null;
 const path=join(process.env.OPENCLAW_DIR||'/root/.openclaw','agents',agent,'agent','openclaw-agent.sqlite');
 if(!existsSync(path))return null;
 const {DatabaseSync}=await import('node:sqlite');let db;
 try{
  db=new DatabaseSync(path,{readOnly:true});
  const window=db.prepare('SELECT session_id FROM session_windows WHERE session_key=? ORDER BY created_at DESC LIMIT 1').get(sessionKey);if(!window)return null;
  // Resolve only the same conversation/account and session. Bounded history
  // recovery survives prompt compaction without searching another user's data.
  const row=db.prepare(`SELECT event_json FROM (SELECT event_json FROM transcript_events WHERE session_id=? ORDER BY seq DESC LIMIT 2000) WHERE json_extract(event_json,'$.message.__openclaw.transport.messageId')=? AND json_extract(event_json,'$.message.__openclaw.transport.conversationRef')=? AND json_extract(event_json,'$.message.__openclaw.transport.accountId')=? LIMIT 1`).get(window.session_id,transport.replyToId,transport.conversationRef,transport.accountId);
  // Older native transport envelopes keep accountId on senderIdentity.
  const fallback=!row&&db.prepare(`SELECT event_json FROM (SELECT event_json FROM transcript_events WHERE session_id=? ORDER BY seq DESC LIMIT 2000) WHERE json_extract(event_json,'$.message.__openclaw.transport.messageId')=? AND json_extract(event_json,'$.message.__openclaw.transport.conversationRef')=? AND json_extract(event_json,'$.message.__openclaw.senderIdentity.accountId')=? LIMIT 1`).get(window.session_id,transport.replyToId,transport.conversationRef,transport.accountId);
  return row||fallback?JSON.parse((row||fallback).event_json).message:null;
 }catch{return null;}finally{db?.close();}
}
export async function buildSourceTurnContext(prompt,history=[],{sessionKey,readReply=nativeReplyTarget}={}){
 const items=history.map(message).filter(m=>['user','assistant'].includes(m?.role));
 const current=[...items].reverse().find(m=>m.role==='user'&&text(m).trim()===String(prompt).trim());
 const native=current?.__openclaw,transport={...native?.transport,accountId:native?.transport?.accountId||native?.senderIdentity?.accountId};
 let target=null;
 if(transport.replyToId){
  target=items.find(m=>m.__openclaw?.transport?.messageId===transport.replyToId&&m.__openclaw?.transport?.conversationRef===transport.conversationRef&&(m.__openclaw?.senderIdentity?.accountId||m.__openclaw?.transport?.accountId)===transport.accountId);
  target=target||await readReply(sessionKey,transport);
 }
 const userPrompt=String(prompt).split('\n\n[System â€” Dashboard chat]')[0];
 const tooLong=userPrompt.length>4000||target&&text(target).length>4000;
 return {...(transport.messageId?{turn_id:createHash('sha256').update(JSON.stringify([transport.accountId,transport.conversationRef,transport.messageId])).digest('hex')}:{}),current_request:tooLong?'[Request exceeds contextual routing bound; ask for clarification]':userPrompt,...(transport.replyToId?{reply_to:{message_id:transport.replyToId,target:target&&!tooLong?{role:target.role,content:text(target)}:null,missing:!target||!!tooLong}}:{}),recent_messages:items.filter(m=>m!==current).slice(-6).map(m=>({role:m.role,content:text(m).slice(0,600)})),...(tooLong?{context_incomplete:true}:{})};
}
export function rememberSemanticTurn(session,context){
 if(!session)return;for(const[k,v]of turns)if(v.until<=Date.now())turns.delete(k);
 if(turns.size>=5000)turns.delete(turns.keys().next().value);
 turns.set(session,{context,until:Date.now()+900000});
}
export function semanticTurnContext(session){const value=turns.get(session);return value?.until>Date.now()?value.context:null;}
export function sourceToolTarget(name,params){const target=String(name||'').replace(/^openclaw:agent-os-content-tools[:.]/,'').replace(/^functions\./,'');return target==='tool_call'?String(params?.id||'').replace(/^openclaw:agent-os-content-tools[:.]/,'').replace(/^functions\./,''):target;}
