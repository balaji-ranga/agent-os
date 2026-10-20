"""Rebuild the scoped pointer, semantic-intent and private-history evidence report.

Run from digital-adoption after collecting the named acceptance artifacts.
Historical attempts remain visible and are not counted as final-source passes.
"""
from pathlib import Path
import datetime, hashlib, html, json, re, shutil, subprocess

service = Path(__file__).resolve().parents[1]
repo = service.parent
root = service / 'test/evidence/pointer-overlay-20261020'
logs = root / 'logs'
logs.mkdir(exist_ok=True)
for source, name in [
    ('overlay-final-service.log', 'service-windows.log'),
    ('overlay-linux-final.log', 'service-linux.log'),
    ('overlay-workspace-final3.log', 'workspace.log'),
    ('overlay-guidance-final3.log', 'field-guidance.log'),
    ('overlay-goals-final3.log', 'goal-ui.log'),
    ('overlay-immediate-final2.log', 'workflow-sdk.log'),
    ('overlay-private-content-final.log', 'private-content.log'),
    ('overlay-docs-build.log', 'docs-build.log'),
    ('overlay-help-final.log', 'help-publication.log'),
    ('overlay-l-deployment.log', 'deployment.log'),
    ('overlay-goals-live-final-k.log', 'live-goals.log'),
    ('overlay-continuity-final-k.log', 'live-continuity.log'),
    ('overlay-history-final.log', 'live-history.log'),
]:
    shutil.copy2(service / '.local' / source, logs / name)
shutil.copytree(service / 'test/evidence/immediate-phase-20261019/overlay-final', root / 'workflow-sdk', dirs_exist_ok=True)
private = json.loads(next(line for line in (logs / 'private-content.log').read_text(encoding='utf-8').splitlines() if line.startswith('{"at"')))
(root / 'private-content.json').write_text(json.dumps(private, indent=2), encoding='utf-8')
raw = (logs / 'service-windows.log').read_text(encoding='utf-8')
count = lambda key: int(re.search(r'^# ' + key + r' (\d+)', raw, re.M)[1])
suites = [dict(name='Service and entitlement regression', method='Contracts, lifecycle, HTTP and connector/policy tests', path='logs/service-windows.log', total=count('tests'), passed=count('pass'), failed=count('fail'), partial=0, deferred=0)]
for name, method, path in [
    ('Pointer · Chrome', 'Real browser, synthetic controls and recorded animation', 'browser-final/results.json'),
    ('Pointer · Edge', 'Real Edge, same independent browser checks', 'edge-final/results.json'),
    ('Workspace', 'SDK/browser; synthetic owner, model and policy fixtures', 'workspace-final/results.json'),
    ('Goal UI', 'SDK/goal progression; synthetic model', 'goals-final/results.json'),
    ('Field guidance', 'SDK/browser, role-scoped fixture', 'field-guidance-final/results.json'),
    ('Workflow server → copilot', 'Actual SDK and WebSocket; synthetic policy/model adapter', 'workflow-sdk/results.json'),
    ('Live semantic continuity', 'Actual deployed maker/passive checker; local draft, no Save', 'continuity-final-k/results.json'),
    ('Live private history', 'Actual deployed sessions/search; refresh, restore, modes and isolation', 'history-final-k/results.json'),
    ('Live goal regression', 'Actual models; approved local saves + independent readback; public host writes blocked', 'live-goals-final-k/results.json'),
    ('Live pointer · both sites', 'Actual deployed direct location, no model needed', 'live-guidance/results.json'),
    ('Loader recovery', 'Actual public page; browser-intercepted initialization/config faults', 'loader-recovery/results.json'),
    ('Private storage and expiry', 'Actual OpenSearch/extractor and expiry worker; isolated authority fixture', 'private-content.json'),
]:
    data = json.loads((root / path).read_text(encoding='utf-8'))
    cases = data.get('results', data.get('cases', []))
    suites.append(dict(name=name, method=method, path=path, total=len(cases), cases=cases, **{key: sum(c['status'] == status for c in cases) for key, status in [('passed', 'passed'), ('failed', 'failed'), ('partial', 'partial'), ('deferred', 'deferred')]}))
summary = {key: sum(s[key] for s in suites) for key in ['total', 'passed', 'failed', 'partial', 'deferred']}
summary['passRate'] = round(100 * summary['passed'] / summary['total'], 2)
assert summary['failed'] == summary['partial'] == 0, 'Do not publish incomplete scoped acceptance as passing'
assert next(s for s in suites if s['name']=='Live goal regression')['total'] == 3, 'All three live goal cases are required'
report = dict(at=datetime.datetime.now(datetime.timezone.utc).isoformat(), release='20261020-pointer-l', baseCommit='9bbb5d7bb1ac93f0658122dac34a309cde8a5c45', summary=summary, suites=suites,
    scope='Generic intent and plural/typo interpretation, read-only pointing versus activation, animated feedback, form/reply/new-task continuity, private conversation archive/restore, view preservation and per-website temporary content. Linux repeats are not double counted.',
    limitations=[
        'This is scoped acceptance, not full Phase 1/2 certification. The broader pre-existing ledger remains 14 passed / 16 partial / 2 deferred; native Safari/iOS/Android and full screen-reader checks are deferred by user instruction.',
        'Read-only targets can highlight buttons, menus, links and rendered content. Arbitrary button/menu execution is not supported. Navigation, field changes and owner-bound Save retain their existing reviews and policies.',
        'The WebSocket regression exercises the real SDK/server command path with an isolated synthetic policy/model adapter. No new signed-in Flolah workflow-runner autonomous grant was used in this release.',
        'The real three-form model test explicitly approves local browser effects, then independently reads the saved records. Public flolah.cloud host submissions are blocked.',
        'Private-storage component authority metadata is isolated; actual browser session/origin/website/visitor entitlement is separately covered by HTTP and live history tests.',
        'The cleanup worker deleted a controlled expired canary. A new 24-hour wall-clock retention interval was not observed. Ended/expired content is denied before physical cleanup.',
        'Index provisioning occurs after successful verification and before activation. Pending/unverified registrations allocate no indexes. Existing approved UAT websites do not prove fresh-owner DNS/email onboarding without prior registration.',
    ])
(root / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
esc = lambda value: html.escape(str(value))
rows = ''.join(f'<tr><td>{esc(s["name"])}<small>{esc(s["method"])}</small></td><td>{s["passed"]}</td><td>{s["partial"]}</td><td>{s["failed"]}</td><td>{s["deferred"]}</td><td><a href="{s["path"]}">Results</a></td></tr>' for s in suites)
cases_html = ''.join('<details><summary>' + esc(s['name']) + '</summary><ul>' + ''.join('<li>' + esc(c['id']) + ' · ' + esc(c['status']) + (' · <a href="' + str(Path(s['path']).parent / c['screenshot']).replace('\\', '/') + '">Screenshot</a>' if c.get('screenshot') else '') + '</li>' for c in s.get('cases', [])) + '</ul></details>' for s in suites[1:])
gallery = ([('user-mcp-panel-connected.jpg', 'User existing in-app browser: panel visibly restored after reload')] if (root/'user-mcp-panel-connected.jpg').exists() else []) + [
    ('continuity-final-k/CONT11_PLURAL_CONTROL_LOCATION_POINTS_WITHOUT_NAVIGATION.png', 'Plural request points to the actual Opportunity link; no activation'),
    ('continuity-final-k/CONT12_NONKEYWORD_LOCATION_AND_UNIQUE_TYPO_STAY_READONLY.png', 'Semantic request and unique typo; no keyword-led navigation'),
    ('continuity-final-k/CONT13_ACTION_WORD_IN_LABEL_DOES_NOT_ACTIVATE_SAVE.png', 'Finding the Save control does not save'),
    ('continuity-final-k/CONT03_INTERPRETS_RECENT_CHANGES_WITHOUT_REPLAY.png', 'Recent applied fields guide using fresh identities'),
    ('continuity-final-k/CONT05_EXPLICIT_REPLY_DEFAULTS_TO_REPLIED_CONTEXT.png', 'Explicit reply continues the referenced field batch'),
    ('history-final-k/HIST00_MODES_MINIMIZE_AND_EXPAND_KEEP_CHAT_AND_DRAFT.png', 'Messages and unsent draft survive mode/window changes'),
    ('history-final-k/HIST01_PLUS_ARCHIVES_AND_STARTS_FRESH_CHAT.png', 'History icon lists private conversation titles'),
    ('history-final-k/HIST06_RESTORED_CONTEXT_GUIDES_FRESH_CONTROL_WITHOUT_REPLAY.png', 'Restored history drives a fresh grounded guide, no replay'),
    ('history-final-k/HIST04_OTHER_WEBSITE.png', 'Another website cannot list the archive, even with copied test proof'),
    ('workflow-sdk/R13_WS_CUSTOMER_NOTE_OPPORTUNITY.png', 'Server-command workflow regression and record readback'),
    ('live-goals-final-k/independent-record-readback.png', 'Actual model-driven three-form saves independently read back'),
]
gallery_html = ''.join(f'<figure><a href="{p}"><img loading="lazy" src="{p}" alt="{esc(label)}"></a><figcaption>{esc(label)}</figcaption></figure>' for p, label in gallery if (root / p).exists())
video = next((root / 'browser-final/video').glob('*.webm'))
style = 'body{font:16px/1.6 system-ui;margin:0;background:#f3f6fa;color:#172c43}main{max-width:1180px;margin:auto;padding:32px}header,.card,details{background:white;border:1px solid #d7e0e9;border-radius:16px;padding:22px;margin:16px 0}h1{line-height:1.15;font-size:38px}h2{margin-top:32px}a{color:#075c9d}.score{font-size:30px;color:#07664c;font-weight:700}small{display:block;color:#52677d;font-weight:400}table{width:100%;border-collapse:collapse;background:white}td,th{padding:12px;text-align:left;border-bottom:1px solid #d7e0e9}.scroll{overflow:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px}figure{margin:0;background:white;border-radius:12px;overflow:hidden;border:1px solid #d7e0e9}img{width:100%;display:block}figcaption{padding:12px}video{width:100%;max-height:650px;background:#111}summary{cursor:pointer;font-weight:650}pre{white-space:pre-wrap;background:#eef4f9;padding:16px;border-radius:8px}li{margin:8px 0}.muted{color:#52677d}'
page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copilot continuity, intent and history acceptance</title><style>' + style + '</style><main>'
page += f'<header><small>Digital Adoption Copilot · {report["release"]}</small><h1>Intent, continuity &amp; private history</h1><p class="score">{summary["passed"]}/{summary["total"]} passed · {summary["passRate"]}%</p><p>{summary["failed"]} failed · {summary["partial"]} partial · {summary["deferred"]} deferred in this scoped suite.</p><p>{esc(report["scope"])}</p><p class="muted">Full Phase 1/2 certification remains separate. See the limitations below.</p></header>'
page += '<section class="card"><h2>Your reported requests</h2><pre>show me opportunities button/link\nhighlight the last changes\nReply: show me those fields again</pre><p>The model interprets the full request, explicit replies and live fields/links/DOM. A uniquely matching plural or typo can identify the observed control. Showing returns highlights; navigation and field changes retain separate reviews, and Save remains separately authorized. No website-specific alias dictionary was introduced.</p><p><strong>History icon retained.</strong> + archives the current chat and starts fresh. Continue restores advisory messages and supports a new grounded follow-up; it does not restore expired task files or replay actions. Private chat and task passages share the configurable 24-hour retention and a temporary index per website. Knowledge indexes remain separate.</p></section>'
page += '<h2>Acceptance and regression</h2><div class="scroll"><table><thead><tr><th>Suite / method</th><th>Pass</th><th>Partial</th><th>Fail</th><th>Deferred</th><th>Evidence</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + cases_html
page += '<h2>Animation evidence</h2><div class="card"><video controls preload="metadata" src="' + video.relative_to(root).as_posix() + '"></video><p>Chrome synthetic controls: guidance animates without a click pulse; an actual approved checkbox, navigation or Save dispatch produces the click pulse. Reduced-motion, stale targets, expiry and Stop are covered.</p></div><h2>Screenshots</h2><div class="grid">' + gallery_html + '</div>'
page += '<h2>Scope and recommendations</h2><div class="card"><ul>' + ''.join('<li>' + esc(x) + '</li>' for x in report['limitations']) + '</ul><p>Recommendation: retain maker/checker, review consequential ambiguous choices, and inspect uncertain Save outcomes instead of retrying. Use the history icon to explicitly continue an earlier chat. Minimize, expand and Use-mode switches preserve active messages and the unsent draft.</p></div>'
page += '<h2>Operations and provenance</h2><div class="card"><ul>' + ''.join(f'<li><a href="{p}">{esc(label)}</a></li>' for p, label in [('deployment-verification.json', 'Scoped deployment verification'), ('runtime-verification.json', 'Final images, health and unchanged global checker'), ('user-browser-confirmation.json', 'Existing user browser confirmation — separate from the 530-check suite'), ('logs/service-linux.log', 'Linux regression repeat — not double counted'), ('logs/help-publication.log', 'Help publication and exact index hash verification'), ('logs/docs-build.log', 'Help documentation build'), ('workflow-sdk/workflow-records.json', 'WebSocket command/independent record evidence'), ('live-goals-final-k/saved-records.json', 'Actual model-driven three-form record readback'), ('storage-source-equivalence.json', 'Live storage test source equivalence'), ('source-sha256.json', 'Source checksums'), ('manifest.sha256.json', 'Evidence checksums'), ('report.json', 'Machine-readable acceptance results')]) + '</ul></div>'
history_paths = ['continuity-live/results.json', 'continuity-live-final/results.json', 'continuity-live-e/results.json', 'history-live/results.json', 'history-live-final/results.json', 'history-restored-continuity/results.json', 'live-goals/results.json', 'live-goals-final/results.json', 'live-goals-final-j/results.json']
page += '<h2>Earlier attempts retained</h2><div class="card"><p>Earlier failures exposed a text-only guide response, missing link highlight contract, navigation continuation, OpenSearch JSON key ordering, startup handler timing and an invalid goal intent enum. They remain evidence of the development process and are not counted as current passes.</p><ul>' + ''.join(f'<li><a href="{p}">{esc(p)}</a></li>' for p in history_paths if (root / p).exists()) + '</ul></div></main></html>'
(root / 'index.html').write_text(page, encoding='utf-8')

# Record changed source bytes in Git's LF-normalized representation.
changed = set(subprocess.check_output(['git', 'diff', '--name-only', report['baseCommit']], cwd=repo, text=True).splitlines())
changed.update(subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=repo, text=True).splitlines())
hashes = {p: hashlib.sha256((repo / p).read_bytes().replace(b'\r\n', b'\n')).hexdigest() for p in sorted(changed) if '/evidence/' not in p and (repo / p).is_file()}
(root / 'source-sha256.json').write_text(json.dumps(hashes, indent=2), encoding='utf-8')

# Keep the existing user-requested URL current while retaining its previous report.
requested = service / 'test/evidence/goal-plans-20261020'
archive = requested / 'history/report-before-pointer-update'
if not archive.exists():
    archive.mkdir(parents=True)
    for name in ['index.html', 'report.json', 'source-sha256.json', 'manifest.sha256.json', 'report-preview.png']:
        shutil.copy2(requested / name, archive / name)
    old = (archive / 'index.html').read_text(encoding='utf-8').replace('<base href="../choice-efficacy-20261020/">', '<base href="../../../choice-efficacy-20261020/">')
    (archive / 'index.html').write_text(old, encoding='utf-8')
banner = '<p class="card">Updated report at the original requested URL. <a href="../goal-plans-20261020/history/report-before-pointer-update/index.html">Earlier 448-check report</a> · <a href="../goal-plans-20261020/history/report-before-choice-update/index.html">Earlier goal report</a>.</p>'
(requested / 'index.html').write_text(page.replace('<html lang="en">', '<html lang="en"><base href="../pointer-overlay-20261020/">', 1).replace('<main>', '<main>' + banner, 1), encoding='utf-8')
for name in ['report.json', 'source-sha256.json']:
    shutil.copy2(root / name, requested / name)
for directory in [root, requested]:
    manifest = {p.relative_to(directory).as_posix(): hashlib.sha256(p.read_bytes().replace(b'\r\n', b'\n') if p.suffix in ['.json', '.html', '.log', '.md', '.mjs', '.txt', '.py'] else p.read_bytes()).hexdigest() for p in sorted(directory.rglob('*')) if p.is_file() and p != directory / 'manifest.sha256.json'}
    (directory / 'manifest.sha256.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(json.dumps(summary))
