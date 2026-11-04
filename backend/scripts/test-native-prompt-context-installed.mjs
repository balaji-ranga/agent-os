import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const root='/usr/local/lib/node_modules/openclaw/dist';
const sources=readdirSync(root).filter(n=>/^builtin-openclaw-.*\.js$/.test(n)).map(n=>readFileSync(`${root}/${n}`,'utf8'));
const source=sources.find(s=>s.includes('const { promptStartedAt } = await runEmbeddedAttemptPromptPhase({'));
assert.ok(source,'Native prompt phase call site required');
const phase=source.indexOf('const { promptStartedAt } = await runEmbeddedAttemptPromptPhase({');
assert.ok(phase>=0);
const start=source.indexOf('\n\t\t\tcontext: {',phase),end=source.indexOf('\n\t\t\texecution: {',start);
assert.ok(start>phase&&end>start);
const block=source.slice(start,end);
// Evaluate the real production context-object construction, before assembly runs.
const make=new Function('sessionRuntimeState','input','setActiveSessionSystemPrompt','toolResultPromptProjectionState',`const boundaryTimezone=undefined,includeBoundaryTimestamp=false,preparedUserTurnMessage=undefined,systemPromptReport=undefined; return ({${block}});`);
const state={systemPromptText:'initial base'};
const input={isRawModelRun:false,setup:{sessionAgentId:'fixture'}};
const prepared=make(state,input,next=>{state.systemPromptText=next;},{});
state.systemPromptText='base + authorized prompt-hook guidance';
assert.equal({...prepared.context}.systemPromptText,state.systemPromptText,'Submission must see post-assembly system context');
state.systemPromptText='next turn + new context';
assert.equal({...prepared.context}.systemPromptText,state.systemPromptText);
// Demonstrate the same regression test catches the previous by-value snapshot.
const oldBlock=block.replace('get systemPromptText() { return sessionRuntimeState.systemPromptText; }','systemPromptText: sessionRuntimeState.systemPromptText');
const oldMake=new Function('sessionRuntimeState','input','setActiveSessionSystemPrompt','toolResultPromptProjectionState',`const boundaryTimezone=undefined,includeBoundaryTimestamp=false,preparedUserTurnMessage=undefined,systemPromptReport=undefined; return ({${oldBlock}});`);
const old=oldMake(state,input,()=>{},{});state.systemPromptText='newly composed guidance';
assert.notEqual({...old.context}.systemPromptText,state.systemPromptText);
console.log('NATIVE_PROMPT_CONTEXT_REGRESSION_OK: actual runtime context object preserves post-hook guidance; previous snapshot fails');
