import assert from 'node:assert/strict';import {readdirSync,mkdtempSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {pruneRecoveryTail} from '../../openclaw-extensions/agent-os-content-tools/recovery-tail.js';
const root='/usr/local/lib/node_modules/openclaw/dist';let Manager;
const state=mkdtempSync(join(tmpdir(),'recovery-tail-'));process.env.OPENCLAW_STATE_DIR=state;process.env.OPENCLAW_DIR=state;
for(const f of readdirSync(root).filter(f=>/^session-manager-.*\.js$/.test(f))){const m=await import(join(root,f));Manager=Object.values(m).find(v=>typeof v==='function'&&v.name==='SessionManager');if(Manager)break;}
assert.ok(Manager);
const isError=e=>e.type==='message'&&e.message?.stopReason==='error';
const options={preserveTrailing:e=>['custom','label','session_info'].includes(e.type)};
for(const decorated of [false,true]){
 const m=Manager.inMemory();for(let i=0;i<3000;i++)m.appendMessage({role:'user',content:'historical '+i,timestamp:i});
 const keep=m.getLeafId();const error=m.appendMessage({role:'assistant',content:[],stopReason:'error',timestamp:3001});
 if(decorated){m.appendCustomEntry('fixture',{ok:true});m.appendLabelChange(keep,'keep');m.appendLabelChange(error,'discard');m.appendSessionInfo('retained name');}
 const before=m.getEntries().slice();m.removeTrailingEntries=()=>{throw Error('full transcript rewrite forbidden')};m.ensureCompletePersistedHistory=()=>{throw Error('full history load forbidden')};
 assert.equal(pruneRecoveryTail(m,isError,options),1);
 assert.ok(m.getEntry(error),'audit record retained');assert.ok(!m.getBranch().some(e=>e.id===error),'synthetic error absent from active branch');
 assert.ok(m.getBranch().some(e=>e.id===keep),'history still active');
 assert.ok(m.fileEntries.length-before.length<8,'bounded append, not suffix replay');
 if(decorated){assert.ok(m.getBranch().some(e=>e.type==='custom'&&e.customType==='fixture'));assert.ok(m.getBranch().some(e=>e.type==='session_info'&&e.name==='retained name'));}
 assert.equal(pruneRecoveryTail(m,isError,options),0,'idempotent cleanup');
}
console.log('RECOVERY_TAIL_OK: bounded native branching, retained audit/history, metadata preservation, no full rewrite, idempotent');
const target={agentId:'fixture',sessionId:'fixture-tail',sessionKey:'agent:fixture:main'};
const persisted=Manager.open(target);const user=persisted.appendMessage({role:'user',content:'retained request',timestamp:1});const error=persisted.appendMessage({role:'assistant',content:[],stopReason:'error',timestamp:2});persisted.appendCustomEntry('fixture',{value:1});
assert.equal(pruneRecoveryTail(persisted,isError,options),1);
const reopened=Manager.open(target);assert.ok(reopened.getEntry(error),'durable audit error retained');assert.ok(reopened.getBranch().some(e=>e.id===user));assert.ok(!reopened.getBranch().some(e=>e.id===error));assert.ok(reopened.getBranch().some(e=>e.type==='custom'&&e.customType==='fixture'));
console.log('RECOVERY_TAIL_DURABLE_REOPEN_OK');
let cleanup,normalize;for(const f of readdirSync(root).filter(f=>/^history-image-prune-.*\.js$/.test(f))){const m=await import(join(root,f));cleanup=Object.values(m).find(v=>typeof v==='function'&&v.name==='removeTrailingMidTurnPrecheckAssistantError');normalize=Object.values(m).find(v=>typeof v==='function'&&v.name==='normalizeCompactionRecoveryTranscriptTail');if(cleanup)break;}
assert.ok(cleanup);const m=Manager.inMemory();m.appendMessage({role:'user',content:'continue',timestamp:1});
const synthetic={role:'assistant',content:[],stopReason:'error',errorMessage:'Context overflow: prompt too large for the model (mid-turn precheck).',timestamp:2};const bad=m.appendMessage(synthetic);m.removeTrailingEntries=()=>{throw Error('installed recovery still rewrites history')};
const activeSession={agent:{state:{messages:[synthetic]}}};cleanup({activeSession,sessionManager:m});assert.equal(activeSession.agent.state.messages.length,0);assert.ok(!m.getBranch().some(e=>e.id===bad));
assert.equal(normalize({activeSession,sessionManager:m}),0,'subsequent normalization must not rewrite the archived error');
console.log('RECOVERY_TAIL_NATIVE_CALLSITE_OK');
