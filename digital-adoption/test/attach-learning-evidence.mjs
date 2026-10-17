import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {appendEvidence,verifyArtifacts} from './evidence-ledger.mjs';
const build=process.argv[2],root=resolve('.local/evidence'),path=resolve(root,'ledger.json'),ledger=JSON.parse(readFileSync(path)),artifact=`learning-${build}.json`,result=JSON.parse(readFileSync(resolve(root,artifact)));
if(result.build!==build||result.checks.length<5||result.browserActionsExecuted!==false)throw new Error('Unexpected learning evidence');
for(const id of ['F19','F22','F27','F30','F31','F32','F37','F41','N01','N14'])appendEvidence(ledger,root,{id,environment:'vps',build,kind:'live-api-with-trusted-synthetic-setup',status:'partial',fullRequirementCovered:false,tester:'automated',steps:'Exercise coaching exchange, sanitized screen observations, recipe publication, separate parameters, stale approvals, mapped import, discovery protocol and guide-only commands through the live API.',expected:'Covered API assertions pass; actual browser actions remain a separate gate.',actual:result.checks.join('; '),artifacts:[artifact]});
if(!verifyArtifacts(ledger,root).valid)throw new Error('Evidence integrity failed');writeFileSync(path,JSON.stringify(ledger,null,2));console.log('Learning/discovery API evidence attached as partial; no browser execution was certified.');
