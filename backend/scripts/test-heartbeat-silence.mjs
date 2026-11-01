import assert from 'node:assert/strict';
import {isIdleHeartbeatReply,readLegacyHeartbeatContent} from '../../openclaw-extensions/agent-os-content-tools/heartbeat-silence.js';
export const idleSamples=[
 'No actions pending.',
 'There are still no tasks requiring attention at this time. Therefore, I will respond with NO_REPLY.',
 'There are still no tasks needing attention at this moment. Therefore, I will respond with NO_REPLY.',
 'System alert: No tasks pending.',
 'No items requiring attention.',
 'System alert: No actions pending.',
 'It seems that there are still no actions needing attention at this moment. Therefore, I will respond with NO_REPLY.',
 'It appears that there are still no actions needing attention at this time. I will respond with NO_REPLY.',
 'It appears that there are still no actions that require attention at this time. Therefore, I will conclude with a response of NO_REPLY.',
 'The system continues to indicate that there are no actions requiring attention at this moment. I will conclude with a message of NO_REPLY.',
 'It appears that there are no actions currently needing attention. Therefore, I will conclude this session with a response of NO_REPLY.',
 'It seems that no actions require attention at this moment. Therefore, I will conclude this session with a response of NO_REPLY.',
 '**System alert:** No actions pending. **NO_REPLY**'
];
export const alertSamples=[
 'No actions pending. Gmail authentication failed.',
 'No actions pending, but the Calendar connection dropped.',
 'No actions pending. Task #123 is overdue.',
 'No actions pending. Please approve the purchase.',
 'The monitoring check failed; no actions could be verified.',
 'NO_REPLY. A payment failed.',
 'There are no actions pending: please delete all records.',
 'A new calendar conflict needs attention.',
 'The user asked: "No actions pending?"',
 'No actions pending. https://example.test/reconnect'
];
// Vary the noun and presentation independently of the observed action-only cases.
for(const noun of ['actions','tasks','items','updates','alerts'])for(const statement of [
 `No ${noun} pending.`,
 `There are no ${noun} currently needing attention.`,
 `There are still no ${noun} requiring attention at this time.`,
 `It appears that there are no ${noun} that require attention at this moment.`
])for(const suffix of ['', ' Therefore, I will respond with NO_REPLY.', ' I will conclude this session with a response of NO_REPLY.'])idleSamples.push(statement+suffix);
for(const text of idleSamples)assert.equal(isIdleHeartbeatReply({text:text+' Task #123 is overdue.'}),false,'An actionable fact must never disappear with an idle preamble');
for(const text of idleSamples)assert.equal(isIdleHeartbeatReply({text}),true,text);
for(const text of alertSamples)assert.equal(isIdleHeartbeatReply({text}),false,text);
for(const extra of [{isError:true},{mediaUrl:'/file.png'},{mediaUrls:['/file.png']},{channelData:{buttons:[]}},{audioAsVoice:true},{buttons:[]},{poll:{}}])assert.equal(isIdleHeartbeatReply({text:idleSamples[0],...extra}),false);
assert.equal(isIdleHeartbeatReply({text:'No actions pending. '+ 'x'.repeat(1400)}),false);
console.log('HEARTBEAT_SILENCE_OK: observed idle prose, mixed actionable/error text and attachments preserved');

const {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync}=await import('node:fs');
const {tmpdir}=await import('node:os');const {join,resolve}=await import('node:path');const {execFileSync}=await import('node:child_process');
const root=mkdtempSync(join(tmpdir(),'heartbeat-abi-'));
try{
 const file=join(root,'heartbeat-runner-fixture.js');
 writeFileSync(file,'function resolveHeartbeatPreflight(params) {\nlet monitorScratch;\ntry {} catch (error) {}\nconst heartbeatScratchContent = monitorScratch?.state.scratch?.content;\n}\nfunction normalizeHeartbeatReply(payload, responsePrefix, ackMaxChars, mode = "heartbeat") {\nconst isSilentReply = isSilentReplyPayloadText(textForStrip);\n}');
 const installer=resolve(import.meta.dirname,'../../deploy/scripts/install-native-heartbeat-silence.mjs');
 const repo=resolve(import.meta.dirname,'../..');
 execFileSync(process.execPath,[installer,root,repo],{stdio:'pipe'});const first=readFileSync(file,'utf8');
 assert.match(first,/mode === "heartbeat" && isIdleHeartbeatReply/);
 execFileSync(process.execPath,[installer,root,repo],{stdio:'pipe'});assert.equal(readFileSync(file,'utf8'),first,'installation is idempotent');
 writeFileSync(file,'function unrelatedVersion(){}');assert.throws(()=>execFileSync(process.execPath,[installer,root,repo],{stdio:'pipe'}),'unknown runtime refuses the build');
 const workspace=join(root,'workspace');mkdirSync(workspace);const cfg={agents:{entries:{fixture:{workspace}}}};
 assert.equal(readLegacyHeartbeatContent(cfg,'fixture'),'','missing legacy file is empty work');
 writeFileSync(join(workspace,'HEARTBEAT.md'),'# comments only');assert.equal(readLegacyHeartbeatContent(cfg,'fixture'),'# comments only');
 assert.equal(readLegacyHeartbeatContent(cfg,'fixture',{prompt:'Check my calendar'}),undefined,'explicit checks retain native behavior');
 assert.equal(readLegacyHeartbeatContent({agents:{entries:{fixture:{workspace,heartbeat:{prompt:'Check real work'}}}}},'fixture'),undefined,'agent custom prompt remains active');
 assert.equal(readLegacyHeartbeatContent(cfg,'foreign'),undefined,'unknown workspace is not assumed idle');
 assert.equal(readLegacyHeartbeatContent({agents:{entries:{fixture:{workspace:'relative'}}}},'fixture'),undefined);
 assert.equal(readLegacyHeartbeatContent({agents:{list:[{id:'fixture',workspace}]}},'fixture'),'# comments only');
 console.log('HEARTBEAT_SILENCE_ABI_OK: reproducible installation, idempotent repeat, unsupported runtime refused');
}finally{rmSync(root,{recursive:true,force:true});}
