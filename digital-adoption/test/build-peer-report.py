"""Update the requested HTML report from actual scoped regression/live evidence."""
from pathlib import Path
import datetime, html, json, os, re, shutil
root=Path(__file__).parent/'evidence/peer-goals-20261020'
load=lambda name:json.loads((root/name).read_text(encoding='utf-8'))
live_dir=os.environ.get('PEER_REPORT_LIVE','live-final-p')
release=os.environ.get('PEER_REPORT_RELEASE','20261020-peer-p')
cohorts=[]
assert '# pass 426' in (root/'logs/service.log').read_text() and '# fail 0' in (root/'logs/service.log').read_text()
cohorts.append(dict(name='Service regression and peer authority',passed=426,failed=0,path='logs/service.log'))
for name,count,title in [('workspace-final-m',21,'Workspace browser regression'),('goals-final-m',8,'Existing goal browser regression'),('peer-final-m',4,'Cross-tab SDK/browser regression')]:
 result=load(name+'/results.json');assert len(result['results'])==count and all(x['status']=='passed' for x in result['results']),name
 cohorts.append(dict(name=title,passed=count,failed=0,path=name+'/results.json'))
shutil.copytree(root.parent/'immediate-phase-20261019/peer-workflow-regression',root/'workflow-sdk',dirs_exist_ok=True)
result=load('workflow-sdk/results.json');assert len(result['results'])==1 and result['results'][0]['status']=='passed'
cohorts.append(dict(name='Workflow WebSocket three-form save/readback (synthetic model/policy)',passed=1,failed=0,path='workflow-sdk/results.json'))
live=load(live_dir+'/results.json')
live_pass=sum(x['status']=='passed' for x in live['results']);live_fail=sum(x['status']=='failed' for x in live['results']);not_run=5-len(live['results'])
cohorts.append(dict(name='Actual maker/checker integrated acceptance',passed=live_pass,failed=live_fail,path=live_dir+'/results.json'))
passed=sum(c['passed'] for c in cohorts);failed=sum(c['failed'] for c in cohorts);full=live_pass==5 and live_fail==0 and not_run==0
certification='Passed for this scoped feature update' if full else 'Conditional: live acceptance incomplete'
report=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),release=release,gatewayRelease=release+'-gateway',baseCommit='abfd9e77',certification=certification,passed=passed,failed=failed,partial=0,notRun=not_run,total=passed+failed+not_run,combinedPassRate=round(100*passed/(passed+failed+not_run),2),regressionPassed=460,regressionFailed=0,latestLivePassed=live_pass,latestLiveFailed=live_fail,latestLiveNotRun=not_run,latestLivePassRate=live_pass*20,cohorts=cohorts,budgetChange=dict(fromTokens=1536,toTokens=2048,approval='Explicit user approval',applied=True),limitations=['Approved loopback site and public flolah.cloud only, in a separate Playwright Chrome profile.','Browser regressions use deterministic model/owner fixtures; live acceptance uses the deployed active maker and passive checker.','No attachment, registration seeding, public host submission, autonomous policy grant or laptop exposure.','Earlier failures/interrupted attempts remain available. One successful run is not a statistical model-reliability guarantee.','Native Safari/iOS, Android and full screen-reader checks remain previously deferred. No fresh-owner DNS/email proof or full Phase 1/2 certification is claimed.'])
(root/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
base='../peer-goals-20261020/';esc=html.escape
section=f'''<section class="card" id="peer-goals"><small>Latest feature update · {release}</small><h1>Private paired goals — no file required</h1><p class="score">460/460 regressions passed</p><p><strong>Latest live acceptance: {live_pass} passed, {live_fail} failed, {not_run} not run ({live_pass*20}%). {certification}.</strong> Current scoped total: {passed}/{passed+failed+not_run} ({report['combinedPassRate']}%). The separate live result determines acceptance; the larger regression count does not conceal live failures.</p><p>The user-approved checker budget is saved as 2,048. Maker/checker remains enabled on the same passive route. Admin, Models &amp; routing and Digital Adoption render the same editor; all save one backend setting, <code>digital_adoption_maker_checker</code>. No page takes precedence; refresh an already-open editor before changing it.</p><p>Private inspection returns supported forms, required fields and navigation. Current nonsecret values are shared only when explicitly selected. A multi-tab goal delegates a complete remote task; its recipient builds local steps with normal field/navigation/Save reviews. The source waits for the actual recipient outcome, not delivery alone.</p><div class="scroll"><table><tr><th>Test cohort</th><th>Passed</th><th>Failed</th><th>Evidence</th></tr>'''
for c in cohorts:section+=f'<tr><td>{esc(c["name"])}</td><td>{c["passed"]}</td><td>{c["failed"]}</td><td><a href="{base+c["path"]}">Results</a></td></tr>'
section+='</table></div><h2>Feature review and recommendations</h2><div class="scroll"><table><tr><th>Feature</th><th>Status</th><th>Recommendation</th></tr>'
features=[('File-free inspection and private current values','Passed' if full else 'See live cases','Pair in Connections; share current values only for the intended task.'),('Cross-tab multi-form goal, Save and returned outcome','Passed' if full else 'Live acceptance incomplete','Keep each contiguous remote assignment in one delegation and review its actual result.'),('Concurrent retry, cancellation, revocation and disconnect fencing','Passed','Failed work is never replayed to a replacement visitor.'),('Server-to-copilot workflow delivery','Passed: isolated policy/model adapter','Workflow entitlement remains independent of visitor peer pairing.'),('Checker policy and budget visibility','Verified','One backend source of truth; consolidate the repeated editor navigation in a future usability change.'),('Native device/accessibility matrix','Previously deferred','Outside this scoped feature update; no full Phase 1/2 certification claim.')]
for title,status,recommendation in features:section+=f'<tr><td>{esc(title)}</td><td>{esc(status)}</td><td>{esc(recommendation)}</td></tr>'
section+='''</table></div><h2>Try it</h2><ol><li>Refresh both approved website tabs once. Pair and confirm them in Connections.</li><li>Select Inspect this copilot to request the other tab’s supported form structure. No attachment is needed.</li><li>For handoff, select sharing consent and optionally Include current nonsecret form values; address the recipient with @ in the ordinary composer.</li><li>In Goal plan mode, describe local work and complete recipient work. Review the plan, each field change, each Save and the peer send.</li><li>Review/start the recipient goal. The source waits for its recorded outcome. End task clears private access; pairing has a separate lifetime.</li></ol><p>Local test: fill/save Customer; inspect paired Note; reuse shared Customer name/email as Note Title/Body; fill/save Note. Independent API and records-page readback must find exactly two synthetic records. Public test: use private Company name as MCP search text, preserve transport default and perform no public submission.</p><div class="grid">'''
images=[('Saved global checker budget, same passive route','checker-budget-2048.png')]
if full:
 images += [('Source goal after both tab saves',live_dir+'/LIVE_PEER02_ACTUAL_MODEL_CUSTOMER_TO_NOTE_GOAL_AND_TWO_SAVES-source.png'),('Recipient Note after reviewed Save',live_dir+'/LIVE_PEER02_ACTUAL_MODEL_CUSTOMER_TO_NOTE_GOAL_AND_TWO_SAVES-note.png'),('Independent saved-record readback',live_dir+'/independent-record-readback.png'),('Public form inspection returned privately',live_dir+'/LIVE_PEER03_CROSS_DOMAIN_INSPECTION_RETURNS_PUBLIC_FIELDS-source.png'),('Public recipient used private source value',live_dir+'/LIVE_PEER04_PRIVATE_FORM_VALUES_DRIVE_PUBLIC_INCOMING_GOAL-public.png')]
else:
 images += [('Earlier real-model source/recipient Save proof','live-g/independent-record-readback.png'),('Separate public transfer branch passed','public-l/LIVE_PEER04_PRIVATE_FORM_VALUES_DRIVE_PUBLIC_INCOMING_GOAL-public.png')]
 for item in live['results']:
  if item['status']=='failed':images.append(('Latest failed live case',live_dir+'/'+item['id']+'-failed-source.png'))
for caption,file in images:
 assert (root/file).is_file(),file
 section+=f'<figure><a href="{base+file}"><img loading="lazy" src="{base+file}" alt="{esc(caption)}"></a><figcaption>{esc(caption)}</figcaption></figure>'
section+='</div><h2>Evidence and limits</h2><ul>'
for label,file in [('Current machine report','report.json'),('Deployed hashes, health and approved settings','runtime-verification.json'),('Deployment verification','deployment.json'),('Linux regression — not counted twice','logs/linux-tests.log'),('Help publication and indexed retrieval','logs/help-publication.log'),('Documentation build','logs/docs-build.log'),('Full real-model trace',live_dir+'/results.json')]:section+=f'<li><a href="{base+file}">{esc(label)}</a></li>'
section+='</ul><ul>'+''.join('<li>'+esc(item)+'</li>' for item in report['limitations'])+'</ul><details><summary>Earlier attempts retained, including failures</summary><ul>'
for path in sorted(root.glob('*/results.json')):
 if path.parent.name not in [live_dir,'workspace-final-m','goals-final-m','peer-final-m','workflow-sdk']:section+=f'<li><a href="{base+path.relative_to(root).as_posix()}">{esc(path.parent.name)}</a></li>'
section+='</ul></details></section>'
for file in [root.parent/'goal-plans-20261020/index.html',root.parent/'pointer-overlay-20261020/index.html']:
 text=file.read_text(encoding='utf-8')
 if 'id="peer-goals"' in text:
  text,n=re.subn(r'<section class="card" id="peer-goals">.*?</section>',lambda _:section,text,count=1,flags=re.S);assert n==1
 else:text=text.replace('<main>','<main>'+section,1)
 file.write_text(text,encoding='utf-8')
print(json.dumps({key:report[key] for key in ['passed','failed','notRun','latestLivePassRate','certification']}))
