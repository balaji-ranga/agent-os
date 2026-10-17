import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLedger,appendEvidence,verifyArtifacts} from './evidence-ledger.mjs';
test('per-case evidence requires artifacts, both environments and full E2E coverage; detects changed artifacts',()=>{
 const plan=Buffer.from(['F','N'].flatMap(prefix=>Array.from({length:prefix==='F'?42:21},(_,i)=>`- **${prefix}${String(i+1).padStart(2,'0')} — Requirement:** details`)).join('\n'));
 const ledger=createLedger(plan),root=mkdtempSync(join(tmpdir(),'adoption-evidence-'));
 try{
  writeFileSync(join(root,'proof.json'),'synthetic verified result');
  const proof={id:'F06',environment:'local',status:'passed',kind:'end-to-end',fullRequirementCovered:true,build:'test-build',steps:'Initialize, retry, initialize distinct instance',expected:'Same retry; distinct instance',actual:'Matches expectation',tester:'automated',artifacts:['proof.json']};
  assert.throws(()=>appendEvidence(ledger,root,{...proof,fullRequirementCovered:false}),/Partial/);
  assert.throws(()=>appendEvidence(ledger,root,{...proof,artifacts:[]}),/artifacts/);
  assert.throws(()=>appendEvidence(ledger,root,{...proof,artifacts:['../outside']}),/within/);
  appendEvidence(ledger,root,proof);assert.equal(ledger.cases.find(c=>c.id==='F06').status,'in_progress');
  appendEvidence(ledger,root,{...proof,environment:'vps'});assert.equal(ledger.cases.find(c=>c.id==='F06').status,'passed');
  assert.equal(ledger.readyForUat,false);assert.equal(verifyArtifacts(ledger,root).valid,true);
  writeFileSync(join(root,'proof.json'),'changed');assert.equal(verifyArtifacts(ledger,root).valid,false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
