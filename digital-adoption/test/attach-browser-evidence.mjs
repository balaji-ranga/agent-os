// Attach an observed browser result, never infer a full testcase pass from a screenshot.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {appendEvidence,verifyArtifacts} from './evidence-ledger.mjs';
const [id,build,artifact,steps,actual]=process.argv.slice(2);
if(!id||!build||!artifact||!steps||!actual)throw new Error('Usage: ID BUILD ARTIFACT STEPS ACTUAL');
const root=resolve('.local/evidence'),path=resolve(root,'ledger.json'),ledger=JSON.parse(readFileSync(path,'utf8'));
appendEvidence(ledger,root,{id,environment:'vps',build,kind:'browser',status:'partial',fullRequirementCovered:false,tester:'interactive-browser',steps,expected:'The described interaction is visibly confirmed; remaining testcase branches require separate evidence.',actual,artifacts:[artifact]});
if(!verifyArtifacts(ledger,root).valid)throw new Error('Evidence integrity check failed');
writeFileSync(path,JSON.stringify(ledger,null,2));console.log(`${id}: browser evidence attached as partial, not full certification.`);
