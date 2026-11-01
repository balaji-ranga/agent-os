// Run in a disposable installed gateway container, --network none, no user volumes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,unlinkSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {runInNewContext} from 'node:vm';import {pathToFileURL} from 'node:url';
import {idleSamples,alertSamples} from './test-heartbeat-silence.mjs';
const dist='/usr/local/lib/node_modules/openclaw/dist';
const name=readdirSync(dist).find(n=>/^heartbeat-runner-.*\.js$/.test(n)&&readFileSync(join(dist,n),'utf8').includes('function normalizeHeartbeatReply('));assert.ok(name);
const source=readFileSync(join(dist,name),'utf8');
const patched='const isSilentReply = isSilentReplyPayloadText(textForStrip) || (mode === "heartbeat" && isIdleHeartbeatReply({ ...payload, text: textForStrip }));';
assert.ok(source.includes(patched),'Native heartbeat ABI adapter must be installed');
const files=['flolah-heartbeat-test-patched.mjs','flolah-heartbeat-test-baseline.mjs'].map(n=>join(dist,n));
try{
 writeFileSync(files[0],source+'\nexport {normalizeHeartbeatReply,resolveHeartbeatPreflight};');
 writeFileSync(files[1],source.replace(patched,'const isSilentReply = isSilentReplyPayloadText(textForStrip);')+'\nexport {normalizeHeartbeatReply};');
 const installed=await import(pathToFileURL(files[0]));const actual=installed.normalizeHeartbeatReply;
 const baseline=(await import(pathToFileURL(files[1]))).normalizeHeartbeatReply;
 for(const text of idleSamples){assert.equal(actual({text},'',300).shouldSkip,true,text);assert.deepEqual(actual({text},'',300,'message'),baseline({text},'',300,'message'),'User-message mode is unchanged');}
 for(const text of alertSamples){assert.deepEqual(actual({text},'',300),baseline({text},'',300),'Actionable/mixed text retains upstream behavior');}
 for(const payload of [{text:'No actions pending.',isError:true},{text:'No actions pending.',mediaUrl:'https://fixture.invalid/image.png'},{text:'No actions pending.',channelData:{buttons:['Review']}}]){assert.deepEqual(actual(payload,'',300),baseline(payload,'',300));assert.equal(actual(payload,'',300).shouldSkip,false);}
 assert.equal(actual({text:'From: COO / Example No actions pending.'},'From: COO / Example',300).shouldSkip,true);
 const workspace=mkdtempSync(join(tmpdir(),'heartbeat-preflight-'));
 try{
  const cfg={agents:{defaults:{systemAgent:{agentId:'fixture-heartbeat'},sessionStore:{agentId:'fixture-heartbeat'}},entries:{'fixture-heartbeat':{workspace}}}};
  const params={cfg,agentId:'fixture-heartbeat',sessionKey:'agent:fixture-heartbeat:main',reason:'interval',source:'interval',scheduledEveryMs:1800000,scheduledTasks:[]};
  writeFileSync(join(workspace,'HEARTBEAT.md'),'# HEARTBEAT.md\n\n# No periodic work configured.\n');
  const initial=await installed.resolveHeartbeatPreflight(params);
  assert.equal(initial.skipReason,'empty-heartbeat-file','empty legacy task file stops before a model request');
  const configured=await installed.resolveHeartbeatPreflight({...params,heartbeat:{prompt:'Check pending approvals'}});assert.equal(configured.skipReason,undefined,'explicit prompt remains active');
  const scheduled=await installed.resolveHeartbeatPreflight({...params,scheduledTasks:[{name:'Real check',prompt:'Read my agenda'}]});assert.equal(scheduled.skipReason,undefined,'scheduled work remains active');
  const wake=await installed.resolveHeartbeatPreflight({...params,reason:'cron:fixture-work',source:'cron'});assert.equal(wake.isCronWake,true);assert.equal(wake.skipReason,undefined,'cron event wake bypass remains active');
  writeFileSync(join(workspace,'HEARTBEAT.md'),'Check the API uptime and report a failure.');
  const legacy=await installed.resolveHeartbeatPreflight(params);assert.equal(legacy.skipReason,undefined);assert.match(legacy.heartbeatScratchContent,/API uptime/,'real legacy instructions are retained');
  const start=source.indexOf('function resolveHeartbeatPreflight(params) {'),end=source.indexOf('\n}',start)+2;let legacyReads=0;
  const faultCase=runInNewContext('('+source.slice(start,end)+')',{resolveHeartbeatWakePayloadFlags:()=>({}),resolveHeartbeatSession:()=>({sessionKey:'fixture'}),selectAgentSystemEvents:()=>[],peekSystemEventEntries:()=>[],isHeartbeatDeliveryAwarenessEvent:()=>false,resolveSystemEventDeliveryContext:()=>undefined,readHeartbeatMonitorScratch:()=>{throw Error('fixture store failure');},resolveCronJobsStorePathFromConfig:()=>'',log$4:{warn(){}},formatErrorMessage:e=>e.message,readLegacyHeartbeatContent:()=>{legacyReads++;return '';},isHeartbeatContentEffectivelyEmpty:()=>false});
  assert.equal(faultCase(params).skipReason,undefined);assert.equal(legacyReads,0,'scratch storage failure cannot be misclassified as idle');
 }finally{rmSync(workspace,{recursive:true,force:true});}
 console.log('HEARTBEAT_EMPTY_WORK_RUNTIME_OK: no-work preflight, configured prompts/tasks/cron wakes retained, legacy content preserved, storage failures not silenced');
 console.log('HEARTBEAT_SILENCE_RUNTIME_OK: installed native normalizer suppresses observed idle outputs, preserves user replies, errors, media and actionable text; zero models/network');
}finally{for(const p of files)try{unlinkSync(p);}catch{}}
