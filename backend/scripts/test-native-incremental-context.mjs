import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
import {incrementalCompactionInstruction} from '../../openclaw-extensions/agent-os-content-tools/context-budget-guidance.js';
const root='/usr/local/lib/node_modules/openclaw/dist';
async function exported(prefix,name){for(const f of readdirSync(root).filter(f=>f.startsWith(prefix)&&f.endsWith('.js'))){const m=await import(join(root,f));const value=Object.values(m).find(v=>typeof v==='function'&&v.name===name);if(value)return value;}throw Error(`Missing native ${name}`);}
const precheck=await exported('helpers-','shouldPreemptivelyCompactBeforePrompt');
const Manager=await exported('session-manager-','SessionManager');
const check=messages=>precheck({messages,systemPrompt:'Analyse sources and preserve evidence.',prompt:'',contextTokenBudget:8192,reserveTokens:2048,toolResultMaxChars:12000});
for(const sourceType of ['mail','document','database']){
 const manager=Manager.inMemory();
 manager.appendMessage({role:'user',content:`Review all ${sourceType} pages`,timestamp:1});
 let pressure,page=0;
 for(;page<30;page++){
  const id=`read-${page}`;
  manager.appendMessage({role:'assistant',content:[{type:'toolCall',id,name:'read_page',arguments:{cursor:`cursor-${page}`}}],stopReason:'toolUse',timestamp:page*2+2});
  manager.appendMessage({role:'toolResult',toolCallId:id,toolName:'read_page',isError:false,content:[{type:'text',text:JSON.stringify({source:sourceType,page,next_cursor:`cursor-${page+1}`,evidence:'Verified source excerpt. '.repeat(250)})}],timestamp:page*2+3});
  pressure=check(manager.buildSessionContext().messages);
  if(pressure.route!=='fits')break;
 }
 assert.ok(page<30,'native budget must detect accumulating page pressure');
 const next=page+1;
 const checkpoint=`Review all ${sourceType} pages. Reviewed pages 0-${page}; source ${sourceType}; findings: source excerpt verified. Exact next cursor: cursor-${next}. Unread pages remain. Pending operation op-fixture and idempotency key request-fixture: already accepted, enquire only; never replay.`;
 const keep=manager.appendMessage({role:'user',content:`Continue remaining ${sourceType} pages from cursor-${next}; do not replay op-fixture.`,timestamp:1000});
 const before=manager.getEntries().length;
 manager.appendCompaction(checkpoint,keep,10000);
 const context=manager.buildSessionContext().messages;
 assert.ok(manager.getEntries().length>before,'durable audit not erased');
 const text=JSON.stringify(context);
 for(const marker of [`cursor-${next}`,'op-fixture','request-fixture','Unread pages'])assert.ok(text.includes(marker),`lost checkpoint ${marker}`);
 const after=check(context);
 assert.equal(after.route,'fits','compacted checkpoint must fit model budget');
}
for(const word of ['snapshot','cursor','tracking IDs','idempotency','unread','supporting excerpts'])assert.ok(incrementalCompactionInstruction.includes(word));
console.log('NATIVE_INCREMENTAL_CONTEXT_OK: mail/document/database pressure, compact continuation, exact cursors/evidence/action IDs, durable audit retained.');
