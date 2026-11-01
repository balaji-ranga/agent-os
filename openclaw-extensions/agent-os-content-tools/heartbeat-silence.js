import {readFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
// Used only at the native heartbeat delivery boundary, never on user replies.
// Match whole, known idle statements; extra facts or errors keep the alert visible.
export function isIdleHeartbeatReply(payload){
 if(!payload||payload.isError||payload.mediaUrl||payload.mediaUrls?.length||payload.audioAsVoice||Object.keys(payload.channelData||{}).length||payload.buttons||payload.poll||payload.location)return false;
 if(typeof payload.text!=='string'||payload.text.length>1200)return false;
 const text=payload.text.replace(/[*`]/g,'').trim().replace(/^system alert\s*:\s*/i,'');
 const sentences=text.split(/[.!?\n]+/).map(s=>s.trim().replace(/\s+/g,' ')).filter(Boolean);
 if(!sentences.length)return false;
 const idle=/^(?:(?:it (?:seems|appears) that|the system (?:continues to )?indicates? that) )?(?:there (?:are|is) )?(?:still )?no (?:actions?|tasks?|items?|updates?|alerts?)(?: (?:are )?(?:currently )?(?:pending|(?:that )?(?:require|requires|requiring|needing) attention))?(?: (?:at (?:this|the) (?:moment|time)|right now|currently))?$/i;
 const silence=/^(?:(?:therefore|so),? )?I (?:will|shall) (?:respond with|conclude(?: this session)? with (?:a (?:message|response) of)) NO_REPLY$/i;
 return sentences.some(s=>idle.test(s))&&sentences.every(s=>idle.test(s)||silence.test(s)||/^(?:NO_REPLY|HEARTBEAT_OK)$/.test(s));
}

// New native scratch records take precedence. This fallback restores the legacy
// task-file contract only for explicit, trusted agent workspaces. Unknown config
// or read failures keep the native check active; an explicit prompt also wins.
export function readLegacyHeartbeatContent(config,agentId,heartbeat){
 const entries=config?.agents?.entries||config?.agents?.list;
 const agent=Array.isArray(entries)?entries.find(a=>a?.id===agentId):entries?.[agentId];
 if(String(heartbeat?.prompt||agent?.heartbeat?.prompt||config?.agents?.defaults?.heartbeat?.prompt||'').trim())return undefined;
 const workspace=agent?.workspace;
 if(typeof workspace!=='string'||!isAbsolute(workspace))return undefined;
 try{return readFileSync(join(workspace,'HEARTBEAT.md'),'utf8');}
 catch(error){return error.code==='ENOENT'?'':undefined;}
}
