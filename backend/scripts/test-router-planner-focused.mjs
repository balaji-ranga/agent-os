import { spawnSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const tests=['test-router-adjudicator-contract.mjs','test-planner-relevance-contract.mjs','test-scoped-orchestrator-handoff.mjs','test-goal-plan-maker-checker-contract.mjs','test-chat-context-boundaries.mjs'];
for(const test of tests){
  const fixture=mkdtempSync(join(tmpdir(),'flolah-focused-contract-'));
  try {
    const run=spawnSync(process.execPath,[join(root,test)],{env:{...process.env,AGENT_OS_DATA_DIR:fixture},stdio:'inherit',timeout:60000});
    if(run.error)throw run.error;
    if(run.status!==0)throw new Error(`${test} failed: ${run.status}`);
  }finally{rmSync(fixture,{recursive:true,force:true});}
}
console.log('PASS all five focused router/planner/retrieval/handoff/context test files; no full regression.');
