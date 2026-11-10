import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {join} from 'node:path';
const root='/usr/local/lib/node_modules/openclaw/dist';
const files=readdirSync(root);
async function exported(prefix,name){for(const f of files.filter(f=>f.startsWith(prefix)&&f.endsWith('.js'))){const m=await import(join(root,f));const v=Object.values(m).find(v=>typeof v==='function'&&v.name===name);if(v)return v;}throw Error(name);}
const Manager=await exported('session-manager-','SessionManager');
const truncate=await exported('tool-result-truncation-','truncateOversizedToolResultsInSessionManager');
const tool=text=>({role:'toolResult',toolCallId:'fixture-call',toolName:'fixture_read',content:[{type:'text',text}],isError:false,timestamp:1});
const huge='fixture '.repeat(30000);
const run=sessionManager=>truncate({sessionManager,contextWindowTokens:4096,maxCharsOverride:1000,aggregateMaxCharsOverride:2000});
const archived=Manager.inMemory();archived.appendMessage(tool(huge));const kept=archived.appendMessage({role:'user',content:'current request',timestamp:2});archived.appendCompaction('Older work summarized',kept,100000);const before=archived.getEntries().length;
assert.equal(run(archived).truncated,false);assert.equal(archived.getEntries().length,before,'archived output must not cause a rewrite');
archived.appendMessage(tool(huge));const prefix=archived.getEntries().slice();assert.equal(run(archived).truncated,true);assert.deepEqual(archived.getEntries().slice(0,prefix.length),prefix,'durable prior entries retained');assert.ok(archived.getEntries().length-prefix.length<5,'only active suffix rewritten');
const retained=Manager.inMemory();const retainedId=retained.appendMessage(tool(huge));retained.appendCompaction('summary',retainedId,100000);assert.equal(run(retained).truncated,true,'firstKept tool remains eligible');
const noBoundary=Manager.inMemory();noBoundary.appendMessage(tool(huge));assert.equal(run(noBoundary).truncated,true,'ordinary history still truncated');
const excluded=Manager.inMemory();excluded.appendMessage({...tool(huge),excludeFromContext:true});assert.equal(run(excluded).truncated,false,'excluded output not a recovery target');
console.log('RECOVERY_CONTEXT_WINDOW_TEST_OK: archived prefix preserved; current/retained outputs truncated; no-boundary and excluded contexts covered');
