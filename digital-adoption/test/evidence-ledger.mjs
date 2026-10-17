import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,relative,isAbsolute,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {acceptanceCases} from './acceptance-catalog.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createLedger(planBytes) {
 const plan=planBytes.toString('utf8');
 const definitions=[...plan.matchAll(/^- \*\*((?:F|N)\d{2}) — ([^\n]+)$/gm)];
 const cases=definitions.map(([,id,definition])=>{
  const functional=acceptanceCases.find(c=>c.id===id);
  const excluded=['F33','F34','F35','F36','N12','N16'].includes(id);
  return {id,phase:functional?.phase|| (excluded?3:'cross-phase'),requirement:definition.replace(/\*\*/g,''),
   status:excluded?'excluded':'not_run',exclusion:excluded?'Phase 3 excluded by user; Phase 2 resource-budget checks remain required.':null,
   local:[],vps:[]};
 });
 if(cases.length!==63||new Set(cases.map(c=>c.id)).size!==63)throw new Error('Plan case catalog changed; reconcile explicitly');
 return {schemaVersion:1,planSha256:sha256(planBytes),createdAt:new Date().toISOString(),readyForUat:false,cases};
}
export function appendEvidence(ledger,root,proof){
 const item=ledger.cases.find(c=>c.id===proof.id);
 if(!item||item.status==='excluded'||!['local','vps'].includes(proof.environment))throw new Error('Case/environment not in scope');
 for(const key of ['build','steps','expected','actual','tester','kind'])if(typeof proof[key]!=='string'||!proof[key].trim())throw new Error(`Missing ${key}`);
 if(!['passed','failed','blocked','partial'].includes(proof.status))throw new Error('Invalid outcome');
 if(!Array.isArray(proof.artifacts)||!proof.artifacts.length)throw new Error('Evidence artifacts required');
 const artifacts=proof.artifacts.map(path=>{
  const absolute=resolve(root,path),rel=relative(resolve(root),absolute);
  if(rel.startsWith('..')||isAbsolute(rel))throw new Error('Artifact must remain within evidence directory');
  return {path:rel.replaceAll('\\','/'),sha256:sha256(readFileSync(absolute))};
 });
 if(proof.status==='passed'&&(proof.kind!=='end-to-end'||proof.fullRequirementCovered!==true))throw new Error('Partial/unit evidence cannot certify a case');
 item[proof.environment].push({...proof,artifacts,at:new Date().toISOString()});
 const latest=env=>item[env].at(-1);
 item.status=['local','vps'].every(env=>latest(env)?.status==='passed')?'passed':proof.status==='failed'?'failed':proof.status==='blocked'?'blocked':'in_progress';
 ledger.readyForUat=ledger.cases.every(c=>['passed','excluded'].includes(c.status));
 return ledger;
}
export function verifyArtifacts(ledger,root){
 const failures=[];
 for(const item of ledger.cases)for(const env of ['local','vps'])for(const proof of item[env])for(const artifact of proof.artifacts){
  const path=resolve(root,artifact.path),rel=relative(resolve(root),path);
  if(rel.startsWith('..')||isAbsolute(rel)||!existsSync(path)||sha256(readFileSync(path))!==artifact.sha256)failures.push(`${item.id}:${env}:${artifact.path}`);
 }
 return {valid:failures.length===0,failures};
}
// CLI deliberately writes only local ignored evidence, never publishes it.
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'))){
 const [command,planPath]=process.argv.slice(2);
 if(command!=='init'||!planPath)throw new Error('Usage: node test/evidence-ledger.mjs init PLAN_PATH');
 const output=resolve('.local/evidence/ledger.json');
 if(existsSync(output))throw new Error('Evidence ledger already exists; preserve prior results');
 mkdirSync(dirname(output),{recursive:true});
 const ledger=createLedger(readFileSync(planPath));writeFileSync(output,JSON.stringify(ledger,null,2));
 console.log(`Initialized ${ledger.cases.length} testcase entries; none marked passed.`);
}
