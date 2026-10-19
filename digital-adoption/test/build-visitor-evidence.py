"""Build an auditable visitor regression report without masking live-model failures."""
from pathlib import Path
import datetime, hashlib, html, json, re

service=Path(__file__).resolve().parents[1]
root=service/'test/evidence/field-guidance-20261019'
def read(path):return json.loads((root/path).read_text(encoding='utf-8-sig'))
def escaped(value):return html.escape(str(value))
def link(path,label=None):return '<a href="'+html.escape(path,quote=True)+'">'+escaped(label or path)+'</a>'
def suite(name,path,scope,repeat=False):
    text=(root/path).read_text(encoding='utf-8-sig')
    if path.endswith('.log'):
        if path=='admin-checker.log':
            assert 'PASS copilot quality:' in text
            passed,failed=1,0
        else:passed,failed=[int(re.findall('^# '+key+r' (\d+)',text,re.M)[-1]) for key in ['pass','fail']]
        cases=[]
    else:
        cases=json.loads(text)['results']
        passed=sum(case['status']=='passed' for case in cases)
        failed=sum(case['status']=='failed' for case in cases)
    return dict(name=name,path=path,scope=scope,passed=passed,failed=failed,cases=cases,repeated=repeat)

suites=[
 suite('Service and authorization · Windows','service-windows.log','335 service tests, including cancellation, denied origins/entitlements, task isolation, expiry, recovery and checker contracts.'),
 suite('Same service tests · VPS Linux','service-linux.log','Final coordinator candidate; repetition is excluded from the unique-check count.',True),
 suite('Admin checker access','admin-checker.log','Isolated real settings routes; Admin-only changes, persistence, dynamic maker/checker slots and secret exclusion.'),
 suite('Grounded pointing and interruption','results.json','Actual SDK/service/DOM/WebSocket; deterministic planner and synthetic identity/policy fixtures.'),
 suite('Deployed pointing · both websites','live/results.json','Actual registered loopback and public Flolah panels. No model override; no host submit. Greeting is not an LLM test.'),
 suite('Real active maker / passive checker','real-model-browser/results.json','Actual platform models in a read-only isolated process. Synthetic registration, retrieval, UTF-8 extraction and policy fixtures. This is not fresh-owner, production OpenSearch or production Ollama certification.'),
 suite('Existing copilot workspace','workspace-regression/results.json','18 browser groups; pairing, unified handoff, task end, capability visibility, reviews, recording, responsive layout and conversation reset. Deterministic planner/extractor and synthetic authentication/policy.'),
 suite('Form and workflow execution','../immediate-phase-20261019/visitor-regression/results.json','13 groups including 30 varied journeys, nine typed editors and 11 WebSocket steps saving/readback of three local records. Deterministic planner and isolated policy adapter; no new real Flolah workflow run.'),
 suite('Complex controls and frameworks','controls-regression/results.json','Native controls, async picklist, dynamic table, modal, React and Angular application-state/readback.'),
 suite('Owner workspace','owner-regression/results.json','Synthetic owner; actual paginated UI, lazy loading, stale responses, website isolation and error/retry.'),
 suite('Deployed private uploads and limits','live-upload/browser-results.json','Both approved registrations, shared-upload denial, private-file cooldown and End task. Synthetic files; no public host submission.'),
 suite('Bootstrap failure and explicit retry','bootstrap-regression/results.json','Injected SDK failure/recovery on both sites; not a network-performance benchmark.'),
 suite('Actual deployed global model route','production-model/results.json','Real registration, indexed knowledge and current shared checker settings after the approved Admin switch. No per-request route override. This suite is a separate release gate.'),
]
assert suites[0]['passed']==335 and suites[0]['failed']==0
assert suites[1]['passed']==335 and suites[1]['failed']==0
assert len(suites[3]['cases'])==8 and len(suites[5]['cases'])==12
assert len(suites[-1]['cases'])==2,'Live model rerun has not completed'
assert read('deployment.json')['release']=='20261019-guidance-h'
assert read('deployment.json')['status']=='passed'
assert 'exact indexed hashes/retrieval verified' in (root/'help-publish.log').read_text(encoding='utf-8-sig')
passed=sum(s['passed'] for s in suites if not s['repeated'])
failed=sum(s['failed'] for s in suites if not s['repeated'])
report=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),release='20261019-guidance-h',
 passed=passed,failed=failed,executedPassRate=round(100*passed/(passed+failed),2),linuxRepeated=335,
 fullPhase12Certified=False,broaderRequirementFamilies=dict(passed=14,partial=16,failed=0,deferred=2),
 suites=suites,
 fixes=[
  'Owned cancellation of a superseded read has TASK_CANCELLED and does not create a raw AbortError banner. Genuine connection interruption remains visible, with no automatic write retry.',
  'Read-only field location resolves fresh observed refs through the scoped proposal/consume path, displays a ten-second marker, scrolls to the input and verifies no write. Ambiguous targets clarify.',
  'Show me where reuses the latest question or page request; clear conversation and End task remove that browser-local context. @handoff and Save are not reused as page-location requests.',
  'An active private file task no longer diverts field pointing into a document summary or waits unnecessarily for extraction.',
  'Generic relative preferences reach semantic review; unsupported literal names remain blocked. Capitalized summary commands are not treated as document subjects.',
  'Checker instructions agree with the maker on obvious observed-option spelling variants, retain clarification for ambiguity and request concise structured feedback. Earlier malformed verdict failures are preserved; a passing rerun is not a general model-stability guarantee.',
 ],
 recommendations=[
  ('Close the actual global-model route gate before full certification. A passive-model isolated pass does not replace the current production checker test.' if failed else 'The actual global route passes with the approved passive checker. Historical Ollama MODEL_TIMEOUT failures remain in the evidence; they are not certified by switching routes.'),
  'The user-approved Admin setting now uses the inactive platform checker with maker/checker enabled. Repair and certify Ollama efficiency mode before selecting it again; no per-website override exists.',
  'Broader Phase 1/2 remains 14 Passed / 16 Partial / 2 Deferred requirement families in the linked acceptance report; these narrower regression groups do not reclassify those gates.',
  'Real Safari/iOS, Android Chrome and full screen-reader verification remain user-deferred. Existing targets do not prove fresh-owner email/DNS onboarding without backend seeding.',
  'Refresh existing website tabs to load the deployed widget. The automated checks used fresh isolated browser contexts and did not reload user-owned tabs.',
 ])
broader=read('../immediate-phase-20261019/report.json')
report['broaderRequirementCases']=broader['cases']
report['broaderAssessmentAt']=broader['at']
(root/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
def counts(s):return ''.join('<td>'+str(s[k])+'</td>' for k in ['passed','failed'])
rows=''.join('<tr><td>'+escaped(s['name'])+'</td>'+counts(s)+'<td>'+escaped(s['scope'])+'<br>'+link(s['path'])+'</td></tr>' for s in suites)
case_sections=[]
for s in suites:
    if not s['cases']:continue
    folder=Path(s['path']).parent.as_posix()
    case_rows=[]
    for c in s['cases']:
        shot=c.get('screenshot')
        evidence=link((Path(folder)/shot).as_posix(),'Screenshot') if shot else link(s['path'],'Assertions / result')
        detail=c.get('detail') or c.get('error') or ''
        if isinstance(detail,dict):detail=json.dumps(detail)
        case_rows.append('<tr><td>'+escaped(c['id'])+'</td><td>'+escaped(c['status'])+'</td><td>'+escaped(detail)+'<br>'+evidence+'</td></tr>')
    case_sections.append('<h3>'+escaped(s['name'])+'</h3><p>'+escaped(s['scope'])+'</p><div class="scroll"><table><tr><th>Test</th><th>Result</th><th>Evidence / explanation</th></tr>'+''.join(case_rows)+'</table></div>')
gallery=['live/public-WHERE_POINTS_TO_ACTUAL_INPUT.png','G03_SUPERSEDING_SLOW_REQUEST_POINTS_WITHOUT_ABORT_ERROR.png','real-model-browser/M03_PREPARE_TYPOS_CHECKBOX_REVIEW_AND_FILL.png','real-model-browser/M09_PRIVATE_FILE_SUMMARY_AND_EXTRACTED_FORM_VALUES.png','production-model/prepare.png']
document='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visitor copilot regression and live model results</title><style>
*{box-sizing:border-box}body{font:15px system-ui;color:#183044;background:#f6f8fb;margin:0}main,header{max-width:1400px;margin:auto;padding:24px}h1{font-size:28px}h2{margin-top:32px}p,li{line-height:1.6}a{color:#175e9d;overflow-wrap:anywhere}.notice{background:#fff4db;border-left:4px solid #997321;padding:16px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;background:white;font-size:13px}th,td{padding:12px;border:1px solid #d7dfe8;text-align:left;vertical-align:top;line-height:1.5}th{background:#eaf0f6}td{overflow-wrap:anywhere}nav{display:flex;gap:20px;flex-wrap:wrap}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px}figure{margin:0}img{width:100%;height:260px;object-fit:contain;object-position:top}figcaption{font-size:12px}</style><header><small>DIGITAL ADOPTION · 19 OCTOBER 2026 · RELEASE 20261019-guidance-h</small><h1>Visitor regression: guidance, knowledge and prepared changes</h1><nav><a href="#results">Results</a><a href="#cases">Test cases</a><a href="#history">Failure history</a><a href="#recommendations">Recommendations</a><a href="report.json">JSON</a></nav></header><main>'''
document+='<p><b>'+str(passed)+' passed / '+str(failed)+' failed</b> across '+str(passed+failed)+' executed unique Windows/browser groups ('+str(report['executedPassRate'])+'%). The same 335 service tests pass on VPS Linux and are not counted twice. Suite scopes below identify fixtures and actual production routes.</p>'
document+='<div class="notice"><b>Full Phase 1/2 certification is not granted.</b> '+('The actual production-model route still has a failing gate. ' if failed else 'The tested release checks pass, but broader acceptance gates remain open. ')+link('../immediate-phase-20261019/index.html','Broader requirement-family table')+' remains 14 Passed / 16 Partial / 2 Deferred. An aggregate rate above 98% does not waive a failed critical gate or certify untested requirements.</div>'
document+='<h2>Generic fixes</h2><ul>'+''.join('<li>'+escaped(x)+'</li>' for x in report['fixes'])+'</ul>'
document+='<h2 id="results">Executed suites</h2><div class="scroll"><table><tr><th>Suite</th><th>Passed</th><th>Failed</th><th>Scope and source</th></tr>'+rows+'</table></div>'
document+='<p>Operations: '+link('deployment.json','final image identities and approved checker policy')+'; '+link('help-publish.log','published help and exact index-hash verification')+'.</p>'
document+='<h2 id="screenshots">Screenshots</h2><div class="gallery">'+''.join('<figure>'+link(x,'Open full screenshot')+'<img loading="lazy" src="'+x+'" alt="'+escaped(Path(x).stem)+'"><figcaption>'+escaped(x)+'</figcaption></figure>' for x in gallery)+'</div>'
document+='<h2 id="cases">Individual browser cases</h2>'+''.join(case_sections)
broader_rows=[]
for case in report['broaderRequirementCases']:
    evidence=', '.join(link('../immediate-phase-20261019/'+path,path) for path in case.get('evidence',[]))
    broader_rows.append('<tr><td>'+escaped(case['id']+' '+case['title'])+'</td><td>'+escaped(case['status'])+'</td><td>'+escaped(case.get('recommendation',''))+'<br>'+evidence+'</td></tr>')
document+='<h2>Retained broader Phase 1/2 gates</h2><p>The 32-family assessment below is retained from '+escaped(report['broaderAssessmentAt'])+'. These family statuses were not upgraded by the narrower regression runs above. Deferred device/accessibility cases remain Deferred. The two actual production-model probes are reported separately in the current executed results.</p><div class="scroll"><table><tr><th>Requirement family</th><th>Status</th><th>Recommendation / existing evidence</th></tr>'+''.join(broader_rows)+'</table></div>'
document+='<p>Approved runtime policy: '+link('admin-checker-change.json','global passive checker audit')+'; '+link('admin-passive-checker.jpg','saved Admin UI screenshot')+'. Maker/checker remains enabled. This is a platform configuration change, not repair or certification of Ollama efficiency mode.</p>'
document+='<h2 id="history">Retained failure history</h2><p>These runs preceded the final generic checker prompt alignment. They are retained rather than overwritten: '+link('history/real-model-first/results.json','first real-model matrix (11 passed / 1 failed)')+', '+link('history/real-model-second/results.json','second matrix (11 passed / 1 failed; VERDICT_SCHEMA)')+', '+link('history/production-before-final/results.json','original production-model run (knowledge passed; Prepare timed out at 180 seconds)')+', '+link('history/production-ollama-final/results.json','final stable Ollama run before the approved switch (both timed out)')+'. A later focused run returned a valid clarification. The current typo case accepts a grounded review or a specific clarification followed by the user’s explicit exact choice; it never accepts an error banner as clarification.</p>'
document+='<h2 id="recommendations">Recommendations and remaining gates</h2><ul>'+''.join('<li>'+escaped(x)+'</li>' for x in report['recommendations'])+'</ul></main></html>'
(root/'index.html').write_text(document,encoding='utf-8')
files=[]
for p in sorted(root.rglob('*')):
    if not p.is_file() or p.name=='artifact-manifest.json':continue
    if p.suffix in ['.json','.html','.log','.txt'] or p.name=='.gitattributes':
        text=p.read_text(encoding='utf-8-sig')
        if p.suffix=='.log':text='\n'.join(line.rstrip() for line in text.splitlines()).rstrip()+'\n'
        p.write_text(text.replace('\r\n','\n'),encoding='utf-8',newline='\n')
    files.append(dict(path=p.relative_to(root).as_posix(),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size))
(root/'artifact-manifest.json').write_text(json.dumps(files,indent=2),encoding='utf-8',newline='\n')
print(json.dumps({key:report[key] for key in ['passed','failed','executedPassRate','fullPhase12Certified']}))
