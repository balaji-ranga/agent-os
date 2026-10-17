import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {appendEvidence,verifyArtifacts} from './evidence-ledger.mjs';
const build=process.argv[2];if(!/^[A-Za-z0-9_-]+$/.test(build||''))throw new Error('Verified build required');
const root=resolve('.local/evidence'),path=resolve(root,'ledger.json'),ledger=JSON.parse(readFileSync(path,'utf8'));
for(const [artifact,ids] of [[`documents-${build}.json`,['F13','F15','F16','F17','F29','N01','N10']],[`url-lifecycle-${build}.json`,['F14','F16','N07']]]){
 const result=JSON.parse(readFileSync(resolve(root,artifact),'utf8'));
 if(result.records&&(!result.records.every(r=>r.status==='passed')||![7,8].includes(result.records.length)))throw new Error('Format acceptance incomplete');
 for(const id of ids)appendEvidence(ledger,root,{id,environment:'vps',build,kind:'live-api-and-real-extraction',status:'partial',fullRequirementCovered:false,tester:'automated',
 steps:result.records?`Upload ${result.records.length} real synthetic formats, poll processing, retrieve in an independent session, deny the other embedding, ask the live model and clear chat.`:'Index an approved public test URL, change the page, refresh and verify the current revision, then remove only the disposable source and assert raw/index cleanup.',
 expected:'Covered backend journeys pass. Browser, moderation, real voice and remaining requirement branches need separate evidence.',actual:result.records?`${result.records.length} formats ready; real OCR and timestamp citations verified; same-embedding sharing and cross-embedding denial passed.`:'URL ingestion, changed-page revision and raw/index deletion passed.',artifacts:[artifact]});
}
if(!verifyArtifacts(ledger,root).valid)throw new Error('Evidence integrity failed');writeFileSync(path,JSON.stringify(ledger,null,2));console.log('Ingestion evidence attached as partial coverage; full UAT readiness is unchanged.');
