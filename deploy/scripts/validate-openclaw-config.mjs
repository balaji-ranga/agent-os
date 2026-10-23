// Complete schema gate: no config values or provider credentials in stdout.
import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolveOpenClawDir} from '../../scripts/lib/openclaw-paths.js';
import {assertOpenClawConfigContract} from '../../scripts/lib/openclaw-config-contract.js';
const path=process.env.OPENCLAW_CONFIG_PATH||join(resolveOpenClawDir(),'openclaw.json');
try{
 if(process.argv.includes('--if-present')&&!existsSync(path)){console.log(JSON.stringify({skipped:true,reason:'Fresh installation: generated config is gated during setup/startup'}));process.exit(0);}
 const before=readFileSync(path,'utf8');assertOpenClawConfigContract(JSON.parse(before));
 const result=spawnSync(process.env.OPENCLAW_CONFIG_VALIDATOR_BIN||'openclaw',['config','validate','--json'],{env:{...process.env,OPENCLAW_CONFIG_PATH:path},encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,windowsHide:true});
 let output;try{output=JSON.parse(result.stdout.trim());}catch{}
 const config=JSON.parse(before);
 const missing=new Set((output?.warnings||[]).filter(w=>/plugin not (installed|found)/i.test(w.message||'')).map(w=>w.path?.replace(/^plugins\.entries\./,'')));
 // This runtime reports absent enabled plugins as warnings. Flolah must fail
 // startup for these, but retain deliberate disabled-plugin policy entries.
 const enabledMissing=[...missing].some(id=>config.plugins?.entries?.[id]?.enabled!==false);
 if(result.error||result.status!==0||output?.valid!==true||enabledMissing){
  // Diagnostics can contain source values; retain only in protected storage.
  writeFileSync(path+'.validation-error.log',JSON.stringify({at:new Date().toISOString(),exitCode:result.status,error:result.error?.code,stdout:result.stdout,stderr:result.stderr}),{mode:0o600});
  throw new Error('Installed OpenClaw schema validation failed; inspect the protected validation-error.log. Running configuration was not replaced by this check.');
 }
 if(readFileSync(path,'utf8')!==before)throw new Error('Configuration changed during validation; retry before startup.');
 if(process.argv.includes('--record-last-good')){
  const temp=path+'.runtime-validated.last-good.tmp-'+process.pid;
  try{writeFileSync(temp,before,{mode:0o600});renameSync(temp,path+'.runtime-validated.last-good');}catch(e){try{unlinkSync(temp);}catch{}throw e;}
  const plugins=[...new Set([...Object.keys(config.plugins?.entries||{}),...(config.plugins?.allow||[])])].filter(id=>!missing.has(id));
  const catalog=join(dirname(path),'flolah-runtime-contract.json'),catalogTemp=catalog+'.tmp-'+process.pid;
  try{writeFileSync(catalogTemp,JSON.stringify({source:'installed-openclaw-schema-validation',validatedAt:new Date().toISOString(),plugins},null,2)+'\n',{mode:0o600});renameSync(catalogTemp,catalog);}catch(e){try{unlinkSync(catalogTemp);}catch{}throw e;}
 }
 console.log(JSON.stringify({valid:true,sha256:createHash('sha256').update(before).digest('hex'),warningCount:output.warnings?.length||0,validator:'installed-openclaw',lastGoodRecorded:process.argv.includes('--record-last-good')}));
}catch(error){console.error('[openclaw-config-gate] '+error.message);process.exitCode=1;}
