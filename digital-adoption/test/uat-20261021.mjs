// Reproducible tester matrix. Real-model journeys are counted separately from
// deterministic browser regression and service tests; failed attempts survive.
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('./evidence/uat-20261021/',import.meta.url);await mkdir(root,{recursive:true});
const suites=[
 ['owner','owner-workspace-browser','browser','ADOPTION_BROWSER_EVIDENCE','Owner tables, pagination, lazy fields, stale responses, tabs and website isolation'],
 ['dynamic','dynamic-guidance-browser','browser','ADOPTION_BROWSER_EVIDENCE','Dynamic DOM targets, follow-ups, ambiguity, loaded picklists and staged option review'],
 ['controls','feedback-controls-browser','browser','ADOPTION_BROWSER_EVIDENCE','Framework-controlled dynamic controls, modal scope, stale choices and duplicate clicks'],
 ['files','visitor-files-live','live','ADOPTION_BROWSER_EVIDENCE','Five private transaction formats, OCR, knowledge citations, reviewed fill/reject and End task'],
 ['workspace','workspace-browser','browser','ADOPTION_BROWSER_EVIDENCE','Chat, files, pairing, history, owner visibility, responsive layout and reconnect'],
 ['goals','goals-browser','browser','ADOPTION_BROWSER_EVIDENCE','Plan, pause/resume, edit/reject, dependent controls, clarification and workflow context'],
 ['peers','peer-goals-browser','browser','ADOPTION_BROWSER_EVIDENCE','Pair without documents, inspect, delegate, fill/save and await actual remote outcome'],
 ['pointer','pointer-overlay-browser','browser','ADOPTION_BROWSER_EVIDENCE','Show versus execute, stale targets, reduced motion, scroll, lifecycle and no duplicate activation'],
 ['immediate','immediate-browser','browser','ADOPTION_IMMEDIATE_RUN','Review validation, missing fields, lost Save acknowledgment, three-form WebSocket workflow, maps and onboarding UI'],
 ['choices','choice-efficacy-live-browser','live','CHOICE_EVIDENCE','Typos, short forms, ambiguity, dynamic picklist, menu guidance, synthetic fields and reviewed Save'],
 ['continuity','continuity-live-browser','live','CONTINUITY_EVIDENCE','Recent changes, reply references, fresh task, form navigation and unrelated new questions'],
 ['history','conversation-live-browser','live','HISTORY_EVIDENCE','Minimize/modes, archive/restore/delete, refresh and user/website entitlement'],
 ['complex','goals-live-browser','live','GOAL_LIVE_EVIDENCE','One prompt creates Customer, Note and Opportunity, handles clarification and public filters'],
 ['multisite','multisite-goal-live','live','ADOPTION_MULTISITE_EVIDENCE','Customer Save then private public-MCP handoff, remote review, transport preserved and no public writes'],
 ['uploads','upload-controls-browser','live','ADOPTION_UPLOAD_EVIDENCE_DIR','Task extraction, server cooldown, visitor shared-upload denial and End task on both domains']
].map(([id,script,kind,env,coverage])=>({id,script,kind,env,coverage}));
const plan={createdAt:new Date().toISOString(),target:98,successDefinition:'Passed / executed test cases; failures count, partial is not passed. First attempt and final retest shown separately. Deterministic regression, real-model browser journeys and service tests are reported separately. Do not claim full certification from weighted unit totals.',scope:['loopback 127.0.0.1:4194','public flolah.cloud opt-in preview','isolated Chrome profile; synthetic host values only; no public host submission'],deferred:['Real Safari/macOS/iOS, Android Chrome, full screen-reader matrix (previously user-deferred)','Fresh-owner real DNS/email onboarding: existing authorized registrations are reused; fixture onboarding is separate','Workflow qualification: real signed-in read-only engine runs passed (4068, 4069); current autonomous fill/Save engine policy was not expanded. Reviewed browser three-form Saves and isolated workflow write regression are separate evidence.','Real screen-sharing permission: synthetic capture regression only unless current interactive permission supplied'],suites};
await writeFile(new URL('plan.json',root),JSON.stringify(plan,null,2));
const selected=process.argv.slice(2),runs=[];
try{runs.push(...JSON.parse(await readFile(new URL('runs.json',root),'utf8')));}catch{}
for(const suite of suites.filter(s=>selected.includes(s.id))){
 const prefix=suite.id+'-attempt-',previous=(await readdir(root)).filter(n=>n.startsWith(prefix)).map(n=>Number(n.slice(prefix.length))).filter(Number.isFinite);const attempt=Math.max(0,...previous)+1,name=suite.id+'-attempt-'+attempt,out=new URL(name+'/',root);await mkdir(out,{recursive:true});const log=new URL(name+'.log',root);
 const env={...process.env};env[suite.env]=suite.id==='uploads'?fileURLToPath(out):suite.id==='immediate'?'uat-20261021-'+name:'./evidence/uat-20261021/'+name+'/';
 if(suite.id==='pointer')env.ADOPTION_BROWSER_CHANNEL='chrome';
 const began=Date.now(),chunks=[];console.log('RUN '+name);
 const processChild=spawn(process.execPath,[fileURLToPath(new URL(suite.script+'.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 for(const stream of [processChild.stdout,processChild.stderr])stream.on('data',data=>{chunks.push(data);});
 let timedOut=false;const timer=setTimeout(()=>{timedOut=true;processChild.kill();},20*60*1000);
 const code=await new Promise(resolve=>{processChild.on('error',e=>{chunks.push(Buffer.from(e.message));resolve(-1);});processChild.on('close',resolve);});clearTimeout(timer);await writeFile(log,Buffer.concat(chunks));
 const entry={id:suite.id,kind:suite.kind,attempt,code,timedOut,startedAt:new Date(began).toISOString(),endedAt:new Date().toISOString(),elapsedMs:Date.now()-began,log:name+'.log',evidence:suite.id==='immediate'?'../immediate-phase-20261019/uat-20261021-'+name+'/':name+'/'};runs.push(entry);await writeFile(new URL(name+'.run.json',root),JSON.stringify(entry,null,2));await writeFile(new URL('runs.json',root),JSON.stringify(runs,null,2));console.log('DONE '+name+' exit='+code+' elapsed='+Math.round(entry.elapsedMs/1000)+'s');
}
