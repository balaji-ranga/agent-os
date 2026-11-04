import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const root=mkdtempSync(join(tmpdir(),'config-convergence-'));
try{
 const path=join(root,'config.json'),bin=join(root,'validator');
 writeFileSync(bin,`#!/usr/bin/env node
const fs=require('fs'),p=process.env.OPENCLAW_CONFIG_PATH,c=JSON.parse(fs.readFileSync(p,'utf8'));
if(process.env.FIXTURE_CHURN==='1'||!c.meta){c.meta={revision:(c.meta?.revision||0)+1};fs.writeFileSync(p,JSON.stringify(c));}
console.log(JSON.stringify({valid:process.env.FIXTURE_INVALID!=='1',warnings:[]}));
`,{mode:0o700});
 const run=extra=>spawnSync(process.execPath,[new URL('./validate-openclaw-config.mjs',import.meta.url).pathname,'--record-last-good'],{env:{...process.env,OPENCLAW_CONFIG_PATH:path,OPENCLAW_CONFIG_VALIDATOR_BIN:bin,...extra},encoding:'utf8',timeout:10000});
 writeFileSync(path,'{}');
 assert.equal(run({}).status,0,'one concurrent publication must converge');
 assert.equal(readFileSync(path+'.runtime-validated.last-good','utf8'),readFileSync(path,'utf8'));
 const good=readFileSync(path+'.runtime-validated.last-good','utf8');
 assert.notEqual(run({FIXTURE_CHURN:'1'}).status,0,'continuous churn stays blocked');
 assert.equal(readFileSync(path+'.runtime-validated.last-good','utf8'),good);
 assert.notEqual(run({FIXTURE_INVALID:'1'}).status,0,'invalid runtime schema stays blocked');
 console.log('CONFIG_CONVERGENCE_OK: retry current revision; preserve schema gate and last-good snapshot');
}finally{rmSync(root,{recursive:true,force:true});}
