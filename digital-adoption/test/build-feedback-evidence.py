"""Build the reviewed, synthetic-only feedback evidence bundle from local UAT output.

This copies an explicit allowlist, never arbitrary .local state or credentials.
Run after the browser, application and VPS checks described in deploy/README.md.
"""
from pathlib import Path
import csv
import hashlib
import json
import shutil

root = Path(__file__).resolve().parent.parent
out = root / 'test/evidence/feedback-20261018'
out.mkdir(parents=True, exist_ok=True)

def copy(folder, name, target=None):
    destination = target or f'{folder.removeprefix("feedback-")}-{name}'
    shutil.copyfile(root / '.local' / folder / name, out / destination)
    return destination

controls = [copy('feedback-controls', n) for n in ['native-complex.png', 'react-state-saved.png', 'angular-state-saved.png', 'action-working.png', 'action-completed.png']]
picklists = [copy('feedback-controls', n) for n in ['picklist-empty-refused.png','picklist-error-refused.png','picklist-ambiguous-refused.png']]
reviews = [copy('feedback-reviews', n) for n in ['field-review-approve-and-reject.png', 'save-review-confirm-and-cancel.png', 'private-review-approve-and-reject.png', 'private-review-rejected-file-retained.png']]
bootstrap = [copy('feedback-bootstrap', n) for n in ['download-failed-local.png', 'recovered-local.png', 'download-failed-public.png', 'recovered-public.png']]
workflow = [copy('feedback-workflow', n) for n in ['incoming-local.png', 'incoming-public.png', 'run4060-local.png', 'run4060-public.png', 'run4060-audit-results.png', 'saved-workflow-targets.png', 'run4062-offline.png', 'owner-workflow-restored-off.png', 'offline-group-retained-local.png']]
context = [copy('feedback-context', n) for n in ['chained-workflow-config.png', 'chain-completed.png', 'run4063-completed.png']]
for folder in ['feedback-controls', 'feedback-reviews', 'feedback-bootstrap', 'feedback-live']:
    copy(folder, 'results.json')
for folder,count in [('feedback-controls',10),('feedback-reviews',2),('feedback-bootstrap',2),('feedback-live',9)]:
    result=json.loads((root/'.local'/folder/'results.json').read_text(encoding='utf-8'))
    assert len(result['results'])==count and all(c['status']=='passed' for c in result['results']), folder
copy('feedback-context', 'chain-result.json')
live = json.loads((root / '.local/feedback-live/results.json').read_text(encoding='utf-8'))
live_images = {}
for result in live['results']:
    live_images[result['id']] = [copy('feedback-live', n) for n in result['screenshots']]
for source, target in [('feedback-regression-final.tap', 'application-local.tap'), ('feedback-vps-final.tap', 'application-vps-image.tap'), ('feedback-capacity-vps.json', 'capacity-vps.json'), ('feedback-connector.tap','connector-core.tap'), ('feedback-runner.log','workflow-runner.log')]:
    shutil.copyfile(root / '.local' / source, out / target)
    if source.startswith(('feedback-regression','feedback-vps')):
        text = (out / target).read_text(encoding='utf-8')
        assert '# tests 208' in text and '# pass 208' in text and '# fail 0' in text, target

original = json.loads((root / '.local/private-preview/guided-feedback.json').read_text(encoding='utf-8-sig'))
assert len(original)==19 and len({c['id']for c in original})==19
def images(prefix):
    return next(v for k, v in live_images.items() if k.startswith(prefix))

details = {
 'F01': ('partial', 'Demo seeding defaults Off. The empty-registration integration exercises registration, DNS/email verification, approval and observation without handbook/maps/recipes; DNS/email transports are synthetic. The existing local registration has historical operator provisioning and seeded content.', 'Repeat fresh empty onboarding through real owner DNS/email self-service before closing this case.', [workflow[7]], ['application-local.tap', 'application-vps-image.tap']),
 'F02': ('passed', 'Immediate busy/disabled state; duplicate activation executes once; bottom completion clears after three seconds, including when the originating button is removed.', 'Keep the generic feedback wrapper on new asynchronous actions.', controls[3:5], ['controls-results.json']),
 'F03': ('passed', 'Native radio/select/multiple-select/checkbox/datalist plus real React 18 and Angular 20 application state and independently persisted synthetic record readback pass. Stale control review is rejected.', 'Support is bounded to the observed accessible controls; certify vendor widgets separately.', controls[:3], ['controls-results.json']),
 'F04': ('passed', 'Real model chat understands Express plus Include gift wrap, presents Selected rather than internal true, supports Reject, and does not submit.', 'Retain mixed-intent and negation regression coverage.', images('F04_MIXED') + images('F04_NATURAL'), ['live-results.json']),
 'F05': ('passed', 'Added and tested async picklist loading/no-match/error/duplicate-label rejection and recovery, dependent contact, table row selection/editing, sorting/filtering/pagination, dynamic rows, modal scope, numeric constraints and persisted table/multiselect values.', 'This certifies the supported accessible fixture patterns. Vendor-specific virtualized grids or closed components still require their own adapter acceptance.', [controls[0], *picklists], ['controls-results.json']),
 'F06': ('passed', 'Pairing is bilateral; counterpart count excludes this panel. Duplicate confirmation/revocation is idempotent and stale errors clear on successful action.', 'Use the counterpart list and current presence instead of interpreting total membership as live peers.', images('F06_F14'), ['live-results.json', 'application-vps-image.tap']),
 'F07': ('passed', 'Shared asynchronous-action feedback suppresses repeated activation and exposes working/completed status. Background presence does not resurrect an old notice.', 'Apply this shared path to newly introduced action controls.', controls[3:5], ['controls-results.json']),
 'F08': ('passed', 'Both actual browser tabs reload and rejoin their saved group using fresh endpoints. Ended private files and approvals are not restored.', 'Reauthorize only after consent expiry/revocation or loss of browser proof.', images('F08_F18'), ['live-results.json', 'application-vps-image.tap']),
 'F09': ('passed', 'Field review includes Reject; Save review includes Cancel save. Rejecting private-file review retains the ready file. Both cancellation journeys independently assert zero host submissions.', 'Keep fill approval and host Save approval separate.', reviews, ['reviews-results.json', 'live-results.json']),
 'F10': ('passed', 'Private summary-only prompt returns an answer with no field review or fill; synthetic host fields remain empty.', 'Continue enforcing read-only intent before generating write proposals.', images('F10_PRIVATE'), ['live-results.json']),
 'F11': ('passed', 'Handoffs use @recipient in the normal bottom composer and Send. Missing sharing consent is rejected; setup is limited to files, pairing/linking and consent.', 'Use the shared composer for further delivery modes.', images('F11_RELAY') + images('F11_F15'), ['live-results.json']),
 'F12': ('passed', 'Reconnect, expiry/revocation and stale endpoint coverage pass; live offline workflow run 4062 reports COPILOT_RECIPIENT_OFFLINE without future delivery. Saved group remains.', 'An uncertain host effect is never automatically replayed; inspect before retrying.', [workflow[6], workflow[8]], ['application-vps-image.tap']),
 'F13': ('passed', 'Injected SDK download failure leaves host usable and visible Retry recovers without host reload on local/public. Explicit retry bypasses the browser cached failed module import.', 'The eight-second attempt limit is a bound; injected recovery timings are not normal startup benchmarks.', bootstrap, ['bootstrap-results.json']),
 'F14': ('passed', 'The confirmer chooses group name, hours/until-revoked and optional inactivity. Presence polling does not renew inactivity; persistence tests cover restart and expiry.', 'Until revoked persists consent, not private task data or perpetual live authorization.', images('F06_F14'), ['application-vps-image.tap', 'live-results.json']),
 'F15': ('passed', 'Sender chat shows the instruction, selected context, recipient and delivery result/time; receiver gets the authorized private context.', 'Private sender content clears when the task ends.', images('F11_F15'), ['live-results.json']),
 'F16': ('passed', 'Workflow user authorization is distinct from website ownership. Independently linked single local target runs without peer pairing; another explicitly authorized same-owner target can join its saved group.', 'Owner must enable workflow capability; visitor must explicitly link; Action Policies still apply. Public temporary capability was restored Off.', [workflow[5], workflow[7]], ['application-vps-image.tap','connector-core.tap','workflow-runner.log']),
 'F17': ('passed', 'Run 4060 shows per-website fields/forms/navigation without entered values. Run 4063 inspect -> summarize passes the task-bound result handle: current form has zero visible fields, yet real LLM correctly reports all three previously observed required fields.', 'Pass task-bound handles between steps before task cleanup; never store transaction text in durable generic workflow audit.', [workflow[4], *context], ['context-chain-result.json']),
 'F18': ('passed', 'Runs 4059 and 4060 use the same saved group and website selection across both tab refreshes without new group/link IDs. Offline run 4062 fails clearly while retaining the group. No peer pairing dependency.', 'Saved groups are reusable target authorizations; commands resolve eligible live endpoints on each run.', [workflow[5], workflow[4], workflow[6]], ['application-vps-image.tap']),
 'F19': ('passed', 'Both visitor panels show full incoming workflow instruction/progress and readable inspection result. Task end removes private instruction/data and keeps a structural completion trace.', 'Review audit plus browser traces together; screenshot capture holds are excluded from latency measurements.', workflow[:5], ['context-chain-result.json']),
}
cases = []
for entry in original:
    status, observed, recommendation, screenshots, artifacts = details[entry['id']]
    cases.append(dict(id=entry['id'], feature=entry['topic'], status=status, observed=observed, recommendation=recommendation, screenshots=screenshots, artifacts=artifacts, section='Guided feedback'))

prior = json.loads((root / 'test/private-acceptance-results.json').read_text(encoding='utf-8'))
for filename in ['private-browser-pdf.json','private-browser-png.json','private-browser-public-pair.json']:
    shutil.copyfile(root/'test/evidence'/filename,out/filename)
for c in prior['cases']:
    c = dict(c, section='End-to-end acceptance', observed=c['evidence'], screenshots=[], artifacts=['private-browser-pdf.json', 'private-browser-png.json', 'private-browser-public-pair.json'])
    c.pop('evidence', None)
    if c['id'] == 'WF01':
        c.update(status='passed', observed='Real signed-in editor saved direct targets, website selection and stable group; real runs 4058/4059/4060 completed without a peer pair.', recommendation='Keep owner policy and entitled workflow-user binding separate.', screenshots=[workflow[5], workflow[4]])
    if c['id'] == 'WF04':
        c.update(status='passed', observed='Real live target disconnect causes run 4062 to fail with COPILOT_RECIPIENT_OFFLINE. Group remains; runner regression checks safe error propagation and duplicate/lost-command paths.', recommendation='No offline queue or replacement visitor. A new run is required after reconnect.', screenshots=[workflow[6]])
    if c['id'] == 'CAP01':
        c.update(observed='Fresh H-image isolated 25-website/25-user capacity result is linked. It includes 50 authenticated sockets, two real Python parsers and 250 HTTP samples, without production mounts.', artifacts=['capacity-vps.json'])
    if c['id'] == 'WF03':
        c.update(observed=c['observed'] + ' Updated real-runner integration also asserts offline error propagation; live browser workflows in this session are read-only.', artifacts=['workflow-runner.log','connector-core.tap'])
    if c['id'] == 'PRIV02':
        c.update(observed=c['observed'] + ' Run 4063 now proves actual chained LLM consumption of authorized private handles before cleanup.', screenshots=[context[-1]], artifacts=['context-chain-result.json','workflow-runner.log'])
    cases.append(c)
for id, feature in [('DEVICE01','Real Safari on macOS/iOS'),('DEVICE02','Real Android Chrome'),('A11Y01','Screen-reader acceptance')]:
    cases.append(dict(id=id, feature=feature, section='Deferred by user', status='pending', observed='Not run; user explicitly asked to keep this device/accessibility case pending.', recommendation='Use approved real devices and assistive technology before full Phase 1/2 certification.', screenshots=[], artifacts=[]))

counts = {s: sum(c['status']==s for c in cases) for s in ['passed','partial','failed','pending']}
report = dict(title='Digital Adoption Copilot — feedback and UAT evidence', date='2026-10-18', runtimeRelease='20261018-feedback-i', publicationRelease='20261018-feedback-j', platformRelease='20261018-feedback-f', status='Scoped feedback implemented and tested; full Phase 1/2 certification remains partial', feedbackCounts={s:sum(c['status']==s for c in cases[:19]) for s in counts}, counts=counts, tests=dict(localApplication=208,vpsImageApplication=208,controlsAndFramework=10,visitorJourneys=9,reviewChecks=2,bootstrapRecovery=2,connectorCore=5,liveWorkflowRuns=[4058,4059,4060,4062,4063]), scope='Loopback laptop fixture and public flolah.cloud only; signed-in Flolah editor is the workflow control plane. No public form submission, login or laptop exposure.', previewExpiry='2026-10-18 15:17 Asia/Singapore; approval is not extended by this report', boundary='One stateful coordinator and SQLite; two parser workers. No multi-coordinator HA, full concurrent model/OCR soak, universal widget or real-device certification.', cases=cases)
(out / 'results.json').write_text(json.dumps(report, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
with (out/'results.csv').open('w', newline='', encoding='utf-8') as file:
    writer=csv.DictWriter(file,fieldnames=['id','section','feature','status','observed','recommendation','screenshots','artifacts']);writer.writeheader()
    for c in cases: writer.writerow({**c,'screenshots':'; '.join(c['screenshots']),'artifacts':'; '.join(c['artifacts'])})

payload=json.dumps(report,ensure_ascii=False).replace('<','\\u003c')
page='''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Digital Adoption UAT evidence</title><style>
:root{color-scheme:light dark;font:15px system-ui;color:light-dark(#18232f,#e5e9ee);background:light-dark(#fafbfc,#151a20)}body{margin:0;padding:30px;max-width:1500px;margin:auto}h1{font-size:24px;margin:0 0 8px}h2{font-size:18px}p{line-height:1.55;max-width:1100px}a{color:light-dark(#124f99,#9dc4f6)}.stats{display:flex;gap:32px;flex-wrap:wrap;margin:25px 0}.stat b{font-size:26px;display:block}.stat span{opacity:.75}.controls{display:flex;gap:10px;margin:24px 0;flex-wrap:wrap}button,input,select{font:inherit;padding:9px;border:1px solid #78818b;border-radius:5px;background:transparent;color:inherit}button{cursor:pointer}button[aria-pressed=true]{font-weight:700;text-decoration:underline}input{min-width:280px}table{width:100%;border-collapse:collapse}th{text-align:left;position:sticky;top:0;background:light-dark(#edf0f3,#202731)}td,th{border-bottom:1px solid #78818b66;padding:14px 10px;vertical-align:top}td:nth-child(1){width:75px}td:nth-child(2){width:115px}td:nth-child(3){width:230px}summary{cursor:pointer;font-weight:600}details p{font-size:14px}img{width:235px;max-width:100%;border:1px solid #78818b66}.gallery{display:flex;gap:12px;flex-wrap:wrap;margin-top:14px}.caption{font-size:12px;max-width:235px;overflow-wrap:anywhere}.note{border-left:3px solid #78818b;padding-left:16px}footer{margin-top:25px;font-size:13px;opacity:.8}@media(max-width:750px){body{padding:15px}table{font-size:13px}td,th{padding:10px 5px}img{width:180px}}
</style><h1>Digital Adoption Copilot: feedback and UAT evidence</h1><p>18 October 2026 · Runtime I / evidence publication J · Platform connector/editor F</p><p class="note"><strong>Full Phase 1/2 certification remains partial.</strong> Guided feedback: 18 passed, 1 partial, 0 failed. Fresh real DNS/email onboarding needs completion. The device/accessibility matrix remains deferred.</p><div class="stats" id="stats"></div><p>Browser scope: loopback laptop fixture + public flolah.cloud. Signed-in Flolah workflows are a separate control plane. Public host writes, login visits and submits: zero. Temporary public workflow permission restored Off. Approved preview expires 15:17 Singapore today.</p><div class="controls" id="filters"><button data-status="all" aria-pressed="true">All cases</button><button data-status="passed">Passed</button><button data-status="partial">Partial</button><button data-status="failed">Failed</button><button data-status="pending">Pending</button><input id="search" aria-label="Search test cases" placeholder="Search feature, result or case ID"><select id="section" aria-label="Case scope"><option>All scopes</option><option>Guided feedback</option><option>End-to-end acceptance</option><option>Deferred by user</option></select></div><p id="count"></p><table><thead><tr><th>Case</th><th>Status</th><th>Feature</th><th>Result, recommendation and evidence</th></tr></thead><tbody id="rows"></tbody></table><footer>Application: 208/208 locally and in the deployed VPS image. Real browser: 10 adapter/framework checks, 9 visitor journeys, 2 cancellation checks and 2 bootstrap recovery checks. Live workflow runs: 4058, 4059, 4060, expected offline failure 4062, chained context 4063. A screenshot demonstrates visible state; assertions and result files supply the behavioral evidence.<p><a href="results.json">JSON ledger</a> · <a href="results.csv">CSV table</a> · <a href="manifest.json">SHA-256 manifest</a> · <a href="capacity-vps.json">Capped capacity pilot</a></p>Single coordinator/SQLite, two parsers; no claim of multi-coordinator HA, full LLM/OCR soak, every website component or untested real devices. Historical private acceptance evidence is retained separately; the current rows identify the updated coverage.</footer><script type="application/json" id="data">PAYLOAD</script><script>
const report=JSON.parse(document.querySelector('#data').textContent),rows=document.querySelector('#rows');let status='all';
const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e};
for(const [label,value]of Object.entries(report.counts)){const s=document.createElement('div');s.className='stat';s.append(text('b',value),text('span',label));document.querySelector('#stats').append(s)}
function render(){rows.replaceChildren();const query=document.querySelector('#search').value.toLowerCase(),section=document.querySelector('#section').value;const selected=report.cases.filter(c=>(status==='all'||c.status===status)&&(section==='All scopes'||c.section===section)&&JSON.stringify(c).toLowerCase().includes(query));document.querySelector('#count').textContent=selected.length+' of '+report.cases.length+' test cases';for(const c of selected){const tr=document.createElement('tr');tr.append(text('td',c.id),text('td',c.status.toUpperCase()),text('td',c.feature));const td=document.createElement('td');td.append(text('p',c.observed),text('p','Recommendation: '+c.recommendation));if(c.screenshots.length||c.artifacts.length){const d=document.createElement('details');d.append(text('summary','Evidence ('+(c.screenshots.length+c.artifacts.length)+')'));for(const file of c.artifacts){const a=text('a',file);a.href=file;a.target='_blank';d.append(a,document.createElement('br'))}const gallery=document.createElement('div');gallery.className='gallery';for(const file of c.screenshots){const a=document.createElement('a');a.href=file;a.target='_blank';const i=document.createElement('img');i.src=file;i.alt=c.id+' — '+file;i.loading='lazy';a.append(i,text('div',file));a.lastChild.className='caption';gallery.append(a)}d.append(gallery);td.append(d)}tr.append(td);rows.append(tr)}}
document.querySelector('#filters').addEventListener('click',e=>{if(!e.target.dataset.status)return;status=e.target.dataset.status;for(const b of document.querySelectorAll('[data-status]'))b.setAttribute('aria-pressed',String(b.dataset.status===status));render()});document.querySelector('#search').oninput=render;document.querySelector('#section').onchange=render;render();
</script></html>'''.replace('PAYLOAD',payload)
(out/'index.html').write_text(page,encoding='utf-8')
for c in cases:
    for filename in c['screenshots']+c['artifacts']:
        assert (out/filename).is_file(), filename
for filename in ['overview.png','partial-cases.png','context-evidence-links.png','results.json']:
    if (root/'.local/feedback-report'/filename).is_file():
        copy('feedback-report',filename)
manifest={p.name:dict(bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(out.iterdir()) if p.is_file() and p.name not in ('manifest.json','.gitattributes')}
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print(json.dumps(dict(counts=counts,feedback=report['feedbackCounts'],files=len(manifest),bytes=sum(p['bytes']for p in manifest.values()))))
