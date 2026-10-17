import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {appendEvidence,verifyArtifacts} from './evidence-ledger.mjs';
const root=resolve('.local/evidence'),ledgerPath=resolve(root,'ledger.json');
const ledger=JSON.parse(readFileSync(ledgerPath,'utf8'));
const [mode,build]=process.argv.slice(2);
if(!['local','vps-live'].includes(mode)||!build)throw new Error('Usage: capture-evidence.mjs local|vps-live VERIFIED_BUILD');
const files=readdirSync('test').filter(f=>f.endsWith('.test.mjs')).map(f=>`test/${f}`);
const result=spawnSync(process.execPath,mode==='local'?['--test',...files]:['test/vps-acceptance.mjs'],{
 encoding:'utf8',env:{...process.env,ADOPTION_DEMO_CONFIG:resolve('.local/demo-public.json')},timeout:180000});
const output=(result.stdout||'')+(result.stderr||'');
if(/dac_session_[A-Za-z0-9_-]+|Bearer\s+[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9_-]{20,}/.test(output))throw new Error('Credential-shaped output blocked from evidence');
const at=new Date().toISOString().replace(/[:.]/g,'-'),artifact=`${mode}-${at}.log`;
writeFileSync(resolve(root,artifact),output);
const ids=mode==='local'?['F02','F03','F05','F06','F07','F08','F09','F10','F11','F12','F17','F22','F25','F27','F30','F31','F32','F37','F40','N01','N02','N06','N14']:
 ['F06','F07','F08','F10','F18','F20','F22','F38','N01','N02'];
for(const id of ids)appendEvidence(ledger,root,{id,environment:mode==='local'?'local':'vps',build,kind:mode==='local'?'component/integration':'live-api',
 status:result.status===0?'partial':'failed',fullRequirementCovered:false,tester:'automated',
 steps:mode==='local'?'Execute all local Node tests; retain complete TAP output.':'Execute VPS HTTP acceptance against real configured model and OpenSearch; retain asserted outcomes.',
 expected:'Covered assertions pass; full testcase remains pending browser/remaining branch coverage.',
 actual:result.status===0?'Covered assertions passed. This artifact does not certify the entire requirement.':`Harness failed with exit ${result.status}; inspect artifact.`,artifacts:[artifact]});
writeFileSync(ledgerPath,JSON.stringify(ledger,null,2));
const verified=verifyArtifacts(ledger,root);
console.log(JSON.stringify({mode,exitCode:result.status,artifact,artifactSha256:createHash('sha256').update(output).digest('hex'),linkedCases:ids,integrity:verified.valid,readyForUat:ledger.readyForUat},null,2));
process.exitCode=result.status===0&&verified.valid?0:1;
