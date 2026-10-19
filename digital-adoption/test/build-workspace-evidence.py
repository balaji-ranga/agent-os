"""Retain the workspace regression evidence without reclassifying broader UAT gaps."""
from pathlib import Path
import datetime, hashlib, html, json, re, shutil

service=Path(__file__).resolve().parents[1]
root=service/'test/evidence/workspace-20261019'
local=service/'.local'
for name,destination in [('workspace-service-regression.log','service-windows.log'),('ux-admin-access-regression.log','admin-access.log')]:
    shutil.copy2(local/name,root/destination)
for folder,destination in [('feedback-controls','controls'),('owner-workspace','owner'),('feedback-bootstrap','bootstrap')]:
    target=root/destination;target.mkdir(exist_ok=True)
    for file in (local/folder).iterdir():
        if file.name=='results.json' or file.suffix=='.png':shutil.copy2(file,target/file.name)

def data(path):return json.loads((root/path).read_text(encoding='utf-8'))
def tap(path):
    text=(root/path).read_text(encoding='utf-8-sig')
    return {key:int(re.findall('^# '+key+r' (\d+)',text,re.M)[-1]) for key in ['pass','fail']}
def suite(name,path,scope,repeat=False):
    if path.endswith('.log'):
        result=tap(path);passed,failed=result['pass'],result['fail']
    else:
        source=data(path);rows=source['results'] if isinstance(source,dict) else source
        passed=sum(row['status']=='passed' for row in rows);failed=sum(row['status']=='failed' for row in rows)
    return dict(name=name,artifact=path,passed=passed,failed=failed,scope=scope,repeatedOnLinux=repeat)

suites=[
    suite('Service / authorization · Windows','service-windows.log','All service regressions; model/provider mocks are labelled.'),
    suite('Service / authorization · VPS Linux','service-linux.log','Exact final coordinator candidate. Same tests, a separate environment verification.',True),
    suite('New workspace acceptance','results.json','Actual SDK, DOM, service and WebSocket; deterministic planner, extractor and synthetic identity/policy fixtures.'),
    suite('Existing form / task regression','../immediate-phase-20261019/workspace-regression/results.json','13 groups, including 30 varied journeys, nine typed editors and 11 WebSocket steps saving/readback of three local records. Isolated policy adapter.'),
    suite('Complex controls / frameworks','controls/results.json','Native controls, dynamic picklists, table, modal, React and Angular state/readback.'),
    suite('Owner workspace regression','owner/results.json','Actual owner UI against isolated synthetic owner; lazy loading, pagination, website isolation and retries.'),
    suite('Deployed workspace · two domains','live-workspace/results.json','Actual deployed local and public Flolah panels; no model call or host edit.'),
    suite('Deployed upload / isolation','live-upload/browser-results.json','Synthetic private files on both approved websites; shared upload 403, cooldown 429, End task. No public host submission.'),
    suite('Bootstrap failure / explicit retry','bootstrap/results.json','Injected SDK download failure and recovery on both websites; not a latency benchmark.'),
]
assert 'PASS copilot quality:' in (root/'admin-access.log').read_text(encoding='utf-8-sig')
suites.append(dict(name='Platform Admin entitlement regression',artifact='admin-access.log',passed=1,failed=0,scope='Real isolated settings routes: 401/403, persisted Admin control and maker/checker routing. No shared Admin changes.',repeatedOnLinux=False))
for s in suites:s['passRate']=100*s['passed']/(s['passed']+s['failed'])
assert all(s['failed']==0 for s in suites)
assert [s['passed'] for s in suites]==[319,319,18,13,10,10,8,8,2,1],'A required regression suite is incomplete'
assert len(data('results.json')['results'])==18
assert data('deployment.json')['release']=='20261019-workspace-d'
assert data('deployment.json')['status']=='passed'
assert '"status": "passed"' in (root/'help-verification.log').read_text(encoding='utf-8-sig')

coverage=[
 ('Workspace shell','Chat, Tasks, Workflows, Connections; Actions gated by coaching. Sticky composer and independent scrolling.','UX01, UX09–11; live-workspace'),
 ('Unified conversation','Questions, guidance, replies and @handoff use one composer. Inline New/Clear review.','UX02, UX06, UX13'),
 ('Quick assistance choices','Show me where / Ask a question / Prepare changes select existing Guide, Knowledge and Assist modes. No automatic effect.','UX18; live-workspace'),
 ('Context disclosure','Current page/form, source channel, private file count and separate connection/retention scope.','UX05, UX14; live-workspace'),
 ('Field reviews','Current/proposed display, typed edit/revalidate, reject; current values remain browser-local.','UX03, UX14; typed editor and stale-review regression'),
 ('Errors and button feedback','Persistent error above composer and in history, explicit dismissal; generic busy/duplicate guard and three-second outcome.','UX04; F02/F07 control regression'),
 ('Execution transparency','Actual progress stages, elapsed time, Stop and bounded failure; no simulated checker success.','T01, T03, R11 existing browser regression; service suite'),
 ('Save outcomes','Separate review, validity, host-reported vs verified receipt and unknown outcome without replay.','R06, R09, R13 existing browser regression'),
 ('Private task files','Upload, parse status, summarize, remove and End task; limits/cooldown retained.','UX05, UX07; live-upload; service suite'),
 ('Pairing and recovery','Visitor-selected lifetime/inactivity, bilateral confirmation, restore, disconnect and explicit live status.','UX06, UX07; service lifecycle suite'),
 ('Peer task relay','Named @recipient, sharing consent, sender/recipient conversation traces. Setup stays in Connections.','UX06, UX07'),
 ('Flolah workflows','Independent linking, persistent target group, run/step/outcome monitor and chat trace; owner teaching previews separate. Earlier completed steps retain their outcome when a later step prepares a review.','UX12 two-step activity isolation; R13 WebSocket regression; Admin/service contracts'),
 ('Coaching access','Owner grant controls Actions. Revocation hides privileged UI and stops local recording; server rechecks authority.','UX08, UX09; service authorization suite'),
 ('Screen capture','Explicit start, pause/resume, review, local download and discard. Shared upload requires authenticated management.','UX16 uses synthetic canvas capture; real browser permission recertification was not repeated.'),
 ('Semantic teaching','Named recording, parameterized draft, review, recipe preview and publication validation preserved.','UX08; service learning suite. Full fresh-owner publish/replay UAT remains open.'),
 ('Discovery and shared sources','Current inspection, bounded read-only map job controls, export and owner-only shared ingestion preserved.','UX08; owner map-context and service suites. New full-site live crawl not repeated.'),
 ('Owner onboarding and isolation','Authenticated management outside visitor panel; selected website, persisted descriptions and readiness remain scoped.','OWNER_READINESS_UI, OWNER_MAP_CONTEXT; 10 owner UI regressions. Fresh real email/DNS remains open.'),
 ('Owner governance and analytics','Owner-only pairing governance and opt-in analytics remain in the website console, not visitor preview drawers.','Existing server policy/isolation regressions; no new real-visitor analytics acceptance claim.'),
 ('Appearance and host layout','Font/theme reset, bounded width/height, expand, minimize; docking only into a host-provided container.','UX10, UX11, UX15, UX17; live-workspace'),
 ('Platform Admin','Authenticated Flolah Admin keeps platform websites and maker/checker controls. Concept-only Admin/error previews are not shipped to visitors.','Admin access regression; UX01. No global model settings changed.'),
]
report=dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),release='20261019-workspace-d',
    result='passed',suites=suites,executedWindowsAndBrowserChecks=sum(s['passed'] for s in suites if not s['repeatedOnLinux']),
    failures=0,minimumExecutedPassRate=min(s['passRate'] for s in suites),fullPhase12Certified=False,
    coverage=[dict(feature=a,implementation=b,validation=c) for a,b,c in coverage],
    limitations=['Deterministic planner/extractor/policy fixtures establish UI and execution contracts, not new real-model acceptance.',
      'Existing live Ollama cited-summary timeout and broader Phase 1/2 partial cases remain open; this UX release does not certify them.',
      'Real Safari/iOS, Android Chrome and full screen-reader checks remain explicitly Deferred.',
      'Docking requires a host-reserved container. Arbitrary third-party page layout is not rewritten.',
      'Both approved live website targets were checked without public form submission or laptop exposure.'])
(root/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
esc=html.escape
def link(path,label=None):return '<a href="'+esc(path,quote=True)+'">'+esc(label or path)+'</a>'
rows=''.join('<tr><td>'+esc(s['name'])+'</td><td>'+str(s['passed'])+'</td><td>'+str(s['failed'])+'</td><td>100%</td><td>'+esc(s['scope'])+'<br>'+link(s['artifact'])+'</td></tr>' for s in suites)
coverage_rows=''.join('<tr><td>'+esc(a)+'</td><td>'+esc(b)+'</td><td>'+esc(c)+'</td></tr>' for a,b,c in coverage)
gallery=['field-review-before-edit.png','UX04_PERSISTENT_FAILURE_ACROSS_VIEWS.png','UX06_PAIRING_SETUP_AND_UNIFIED_HANDOFF.png','UX12_DISABLED_FEATURES_AND_WORKFLOW_ONLY_VISITOR.png','live-workspace/public-CONNECTED_VISITOR_ENTITLEMENTS.png','live-workspace/local-SHORT_VIEWPORT_COMPOSER_AND_KEYBOARD.png']
document='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copilot workspace regression evidence</title><style>
*{box-sizing:border-box}body{font:15px system-ui;margin:0;color:#183044;background:#f5f7fa}header,main{max-width:1400px;margin:auto;padding:24px}h1{font-size:26px}h2{font-size:20px;margin-top:28px}p,li{line-height:1.6}a{color:#175e9d;overflow-wrap:anywhere}.notice{padding:16px;border-left:4px solid #986d20;background:#fff8e9}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px;background:white}td,th{padding:12px;text-align:left;vertical-align:top;border:1px solid #d6e0e9;line-height:1.5}th{background:#e9eff5}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:16px}figure{margin:0}img{width:100%;height:260px;object-fit:contain;object-position:top}figcaption{font-size:12px}nav{display:flex;gap:16px;flex-wrap:wrap}</style>
<header><small>DIGITAL ADOPTION · 19 OCTOBER 2026</small><h1>Workspace acceptance and copilot regression</h1><p>Release 20261019-workspace-d · all executed suites pass.</p><nav><a href="#results">Results</a><a href="#coverage">Design coverage</a><a href="#screenshots">Screenshots</a><a href="report.json">JSON</a></nav></header><main>'''
document+='<p><b>'+str(report['executedWindowsAndBrowserChecks'])+' / '+str(report['executedWindowsAndBrowserChecks'])+' executed Windows/browser checks passed</b>; the same 319 service tests also pass on VPS Linux. The Linux repetition is not counted as additional unique tests. Thirty varied journeys sit inside the existing 13 browser groups and are not counted twice.</p>'
document+='<div class="notice"><b>Certification boundary:</b> This is the workspace release regression, not full Phase 1/2 certification. '+link('../immediate-phase-20261019/index.html','The broader acceptance table')+' retains its 14 passed / 16 partial / 2 deferred requirement families. Its older executed-suite data is historical; this page records the latest workspace rerun. No real-model issue is reclassified by these UI passes.</div>'
document+='<h2 id="results">Executed results</h2><div class="scroll"><table><thead><tr><th>Suite</th><th>Passed</th><th>Failed</th><th>Rate</th><th>Scope / evidence</th></tr></thead><tbody>'+rows+'</tbody></table></div>'
document+='<p>Operational checks: '+link('deployment.json','deployed image / health / preserved services')+'; '+link('help-verification.log','exact help hashes and retrieval')+'.</p>'
document+='<h2 id="coverage">Reference experience coverage</h2><p>All 20 experience families were reviewed. The table identifies implemented presentation changes, preserved functionality and the limit of each test. Simulated Admin and service-error preview controls remain concept-only; production access always uses authenticated server capabilities.</p><div class="scroll"><table><thead><tr><th>Experience</th><th>Implementation</th><th>Validation / limits</th></tr></thead><tbody>'+coverage_rows+'</tbody></table></div>'
document+='<h2 id="screenshots">Screenshots</h2><div class="gallery">'+''.join('<figure>'+link(x,'Open full screenshot')+'<img src="'+x+'" alt="'+esc(Path(x).stem)+'" loading="lazy"><figcaption>'+esc(Path(x).stem)+'</figcaption></figure>' for x in gallery)+'</div><h2>Recommendations and remaining boundaries</h2><ul>'+''.join('<li>'+esc(x)+'</li>' for x in report['limitations'])+'</ul></main></html>'
(root/'index.html').write_text(document,encoding='utf-8')
files=[]
for p in sorted(root.rglob('*')):
    if not p.is_file() or p.name=='artifact-manifest.json' or '-failed' in p.name:continue
    if p.suffix in ['.json','.log','.html']:
        with p.open('r',encoding='utf-8-sig') as stream:content=stream.read()
        with p.open('w',encoding='utf-8',newline='\n') as stream:stream.write(content)
    files.append(dict(path=p.relative_to(root).as_posix(),sha256=hashlib.sha256(p.read_bytes()).hexdigest(),bytes=p.stat().st_size))
(root/'artifact-manifest.json').write_text(json.dumps(files,indent=2),encoding='utf-8')
print(json.dumps(dict(passed=report['executedWindowsAndBrowserChecks'],failed=0,linuxRepeated=319,fullPhase12Certified=False)))
