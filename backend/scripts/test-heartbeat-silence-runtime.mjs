// Run in a disposable installed gateway container, --network none, no user volumes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';import {pathToFileURL} from 'node:url';
import {idleSamples,alertSamples} from './test-heartbeat-silence.mjs';
const dist='/usr/local/lib/node_modules/openclaw/dist';
const name=readdirSync(dist).find(n=>/^heartbeat-runner-.*\.js$/.test(n)&&readFileSync(join(dist,n),'utf8').includes('function normalizeHeartbeatReply('));assert.ok(name);
const source=readFileSync(join(dist,name),'utf8');
const patched='const isSilentReply = isSilentReplyPayloadText(textForStrip) || (mode === "heartbeat" && isIdleHeartbeatReply({ ...payload, text: textForStrip }));';
assert.ok(source.includes(patched),'Native heartbeat ABI adapter must be installed');
const files=['flolah-heartbeat-test-patched.mjs','flolah-heartbeat-test-baseline.mjs'].map(n=>join(dist,n));
try{
 writeFileSync(files[0],source+'\nexport {normalizeHeartbeatReply};');
 writeFileSync(files[1],source.replace(patched,'const isSilentReply = isSilentReplyPayloadText(textForStrip);')+'\nexport {normalizeHeartbeatReply};');
 const actual=(await import(pathToFileURL(files[0]))).normalizeHeartbeatReply;
 const baseline=(await import(pathToFileURL(files[1]))).normalizeHeartbeatReply;
 for(const text of idleSamples){assert.equal(actual({text},'',300).shouldSkip,true,text);assert.deepEqual(actual({text},'',300,'message'),baseline({text},'',300,'message'),'User-message mode is unchanged');}
 for(const text of alertSamples){assert.deepEqual(actual({text},'',300),baseline({text},'',300),'Actionable/mixed text retains upstream behavior');}
 for(const payload of [{text:'No actions pending.',isError:true},{text:'No actions pending.',mediaUrl:'https://fixture.invalid/image.png'},{text:'No actions pending.',channelData:{buttons:['Review']}}]){assert.deepEqual(actual(payload,'',300),baseline(payload,'',300));assert.equal(actual(payload,'',300).shouldSkip,false);}
 assert.equal(actual({text:'From: COO / Example No actions pending.'},'From: COO / Example',300).shouldSkip,true);
 console.log('HEARTBEAT_SILENCE_RUNTIME_OK: installed native normalizer suppresses observed idle outputs, preserves user replies, errors, media and actionable text; zero models/network');
}finally{for(const p of files)try{unlinkSync(p);}catch{}}
