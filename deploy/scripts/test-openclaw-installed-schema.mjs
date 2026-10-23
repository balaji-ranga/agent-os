// Run only in an isolated container with the production volume mounted read-only.
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const source=process.env.OPENCLAW_CONFIG_PATH||'/root/.openclaw/openclaw.json';
const original=readFileSync(source,'utf8'),hash=s=>createHash('sha256').update(s).digest('hex');
const temp=mkdtempSync(join(tmpdir(),'flolah-schema-test-'));
const results=[];
try{
 for(const [name,mutate,valid]of [
  ['valid recovered configuration',()=>{},true],
  ['overlong agent ID',c=>{c.agents={entries:{['x'.repeat(65)]:{}}};},false],
  ['invalid tool profile',c=>{c.tools={profile:'unsupported-profile'};},false],
  ['unknown enabled plugin',c=>{c.plugins??={};c.plugins.entries??={};c.plugins.entries['flolah-deliberately-absent-schema-test']={enabled:true};},false],
  ['installed-only schema mismatch',c=>{c.gateway??={};c.gateway.port='invalid-port';},false],
 ]){
  const candidate=JSON.parse(original);mutate(candidate);
  const path=join(temp,'candidate.json');writeFileSync(path,JSON.stringify(candidate),{mode:0o600});
  const run=spawnSync(process.execPath,['/opt/agent-os/deploy/scripts/validate-openclaw-config.mjs'],{env:{...process.env,OPENCLAW_CONFIG_PATH:path},encoding:'utf8',timeout:150000,maxBuffer:4*1024*1024});
  if(run.error||((run.status===0)!==valid))throw new Error('Unexpected installed-schema result: '+name+' (exit '+run.status+')');
  results.push({name,passed:true});
 }
 if(hash(readFileSync(source,'utf8'))!==hash(original))throw new Error('Read-only source changed');
 results.push({name:'source configuration unchanged',passed:true});
 console.log(JSON.stringify({suite:'installed-openclaw-schema',passed:results.length,failed:0,results}));
}finally{rmSync(temp,{recursive:true,force:true});}
