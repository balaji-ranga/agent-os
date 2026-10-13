"""Prepare and activate a scoped observer API/UI release. Never restart Gateway.

Usage: python3 vps-observer-recovery-release.py prepare|activate RELEASE_DIR
All images are captured from running containers, not a potentially stale host tree.
Preparation is non-mutating to live sources/services. Activation backs up SQLite
and touched host files, preserves Compose overlays, and rolls back images on error.
"""
import hashlib,json,pathlib,re,shutil,subprocess,sys,time

root=pathlib.Path('/opt/agent-os')
mode=sys.argv[1]
release=pathlib.Path(sys.argv[2]).resolve()
manifest=json.loads((release/'manifest.json').read_text())
revision=manifest['revision']
if not re.fullmatch(r'[-\w]+',revision):raise RuntimeError('Invalid revision')
if release.parent!=root/'releases':raise RuntimeError('Release must be under /opt/agent-os/releases')
context=release/'context'
paths=manifest['modified']+manifest['added']
generated=['backend/src/generated/copilot-screen-inventory.json','frontend/src/generated/copilot-screen-inventory.json']
sync_paths=list(dict.fromkeys(paths+generated))
for p in paths:
    rel=pathlib.PurePosixPath(p)
    if rel.is_absolute() or '..' in rel.parts:raise RuntimeError('Unsafe feature path')

def run(*args,**kw):return subprocess.run(args,check=True,**kw)
def inspect(service):return json.loads(subprocess.check_output(['docker','inspect','agent-os-'+service+'-1']))[0]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
def signature(service):
    d=inspect(service);return {'id':d['Id'],'image':d['Image'],'started':d['State']['StartedAt']}
def merge(p,current):
    if p in manifest['added']:
        desired=(release/'files'/p).read_bytes()
        if current.exists() and current.read_bytes().replace(b'\r\n',b'\n')!=desired.replace(b'\r\n',b'\n'):raise RuntimeError('New-file collision: '+p)
        return desired
    if not current.exists():raise RuntimeError('Missing merge source: '+p)
    parts=[]
    for i,source in enumerate([release/'files'/p,release/'base'/p,current]):
        tmp=release/f'merge-{i}.tmp';tmp.write_bytes(source.read_bytes().replace(b'\r\n',b'\n'));parts.append(str(tmp))
    result=subprocess.run(['git','merge-file','-p',*parts],capture_output=True)
    if result.returncode:raise RuntimeError('Manual merge required: '+p)
    return result.stdout

if mode=='prepare':
    if context.exists():raise RuntimeError('Context already exists')
    release.chmod(0o700)
    (context/'backend').mkdir(parents=True)
    (context/'frontend').mkdir()
    captured={s:signature(s) for s in ['backend','frontend','openclaw','content-converter','ollama']}
    configs={s:inspect(s)['Config']['Labels']['com.docker.compose.project.config_files'] for s in ['backend','frontend']}
    for s in ['backend','frontend']:run('docker','tag',captured[s]['image'],f'agent-os-{s}:observer-rollback-{revision}')
    for part in ['src','scripts','package.json','package-lock.json']:
        run('docker','cp',f'agent-os-backend-1:/opt/agent-os/backend/{part}',str(context/'backend'/part))
    run('docker','cp','agent-os-backend-1:/opt/agent-os/openclaw-workspace-templates',str(context/'openclaw-workspace-templates'))
    label=inspect('frontend')['Config']['Labels'].get('org.flolah.kanban-observer.source-context')
    if label:frontend_source=pathlib.Path(label)/'frontend'
    else:
        previous=inspect('frontend')['Config']['Labels'].get('org.flolah.copilot.revision')
        if not previous or not re.fullmatch(r'[-\w]+',previous):raise RuntimeError('Running frontend source label unavailable')
        frontend_source=root/'releases'/('copilot-'+previous)/'context/frontend'
    if not frontend_source.is_dir():raise RuntimeError('Running frontend source missing; refusing host fallback')
    shutil.copytree(frontend_source,context/'frontend',dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules','dist','.env*'))
    checks={p:sha(root/p) for p in sync_paths}
    host=release/'host-source'
    for p in paths:
        target=context/p;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_bytes(merge(p,target))
        dest=host/p;dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_bytes(merge(p,root/p))
    # Regenerate the parallel copilot inventory from the actual patched UI source.
    # This is a mechanical generator; both API and UI receive the same inventory.
    run('docker','run','--rm','-v',f'{context}:/release','-w','/release/frontend','node:22-bookworm-slim','sh','-c','npm ci && node scripts/generate-copilot-screen-inventory.mjs')
    for p in generated:
        dest=host/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(context/p,dest)
    (context/'.dockerignore').write_text('**/node_modules\n**/dist\n**/.git\n**/.env*\n')
    (context/'backend-overlay.Dockerfile').write_text(f'''FROM agent-os-backend:observer-rollback-{revision}
ARG RELEASE_REVISION
LABEL org.flolah.kanban-observer.revision=$RELEASE_REVISION
COPY backend/src /opt/agent-os/backend/src
COPY backend/scripts /opt/agent-os/backend/scripts
COPY backend/package.json /opt/agent-os/backend/package.json
COPY openclaw-workspace-templates /opt/agent-os/openclaw-workspace-templates
WORKDIR /opt/agent-os/backend
''')
    (context/'frontend-overlay.Dockerfile').write_text(f'''FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
ENV VITE_API_URL=/api
RUN npm run test:chat && npm run build
FROM agent-os-frontend:observer-rollback-{revision}
ARG RELEASE_REVISION
LABEL org.flolah.kanban-observer.revision=$RELEASE_REVISION
LABEL org.flolah.kanban-observer.source-context="{context}"
COPY --from=build /app/dist /usr/share/nginx/html
''')
    (release/'captured.json').write_text(json.dumps({'services':captured,'configs':configs,'checks':checks},indent=2))
    for s in ['backend','frontend']:run('docker','build','-f',str(context/f'{s}-overlay.Dockerfile'),'--build-arg',f'RELEASE_REVISION={revision}','-t',f'agent-os-{s}:observer-{revision}',str(context))
    suites=['test-observer-uncertainty.mjs','test-kanban-task-observer.mjs','test-observer-recovery-completion.mjs','test-efficiency-controls.mjs','test-tool-tenant-boundaries.mjs','test-notify-approval-lifecycle.mjs']
    # Disposable test DBs and mocked providers, zero production volumes/network.
    for script in suites:
        run('docker','run','--rm','--network','none',f'agent-os-backend:observer-{revision}','node','scripts/'+script)
    run('docker','run','--rm','--network','none',f'agent-os-backend:observer-{revision}','npm','run','test:ui-copilot')
    (release/'prepared.ok').write_text('Prepared and regression-tested\n')
    print('OBSERVER_PREPARED '+revision)
elif mode=='activate':
    if not (release/'prepared.ok').exists():raise RuntimeError('Preparation/test gate missing')
    if (release/'activated.ok').exists():raise RuntimeError('Release already activated')
    state=json.loads((release/'captured.json').read_text())
    for s,sig in state['services'].items():
        if signature(s)!=sig:raise RuntimeError('Concurrent service deployment: '+s)
    for p,h in state['checks'].items():
        if sha(root/p)!=h:raise RuntimeError('Concurrent host-source change: '+p)
    # Locate DB through its runtime module, without initDb/getDb schema writes.
    backup_code='''import Database from "better-sqlite3";import {join} from "node:path";const db=new Database(join(process.env.AGENT_OS_DATA_DIR||"/opt/agent-os/backend/data","agent-os.db"),{readonly:true,fileMustExist:true});await db.backup(process.env.OBSERVER_BACKUP);db.close();'''
    run('docker','exec','-e',f'OBSERVER_BACKUP=/tmp/observer-{revision}.db','agent-os-backend-1','node','--input-type=module','-e',backup_code)
    run('docker','cp',f'agent-os-backend-1:/tmp/observer-{revision}.db',str(release/'database-before.db'))
    (release/'database-before.db').chmod(0o600)
    source_backup=release/'source-before'
    for p in sync_paths:
        if (root/p).exists():
            dest=source_backup/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/p,dest)
    def recreate(s,image):
        override=release/(s+'.override.yml');override.write_text(f'services:\n  {s}:\n    image: {image}\n')
        args=['docker','compose','-p','agent-os']
        for f in state['configs'][s].split(','):args+=['-f',f]
        run(*args,'-f',str(override),'up','-d','--no-deps','--no-build','--force-recreate',s,cwd=root/'deploy')
    try:
        for s in ['backend','frontend']:recreate(s,f'agent-os-{s}:observer-{revision}')
        for attempt in range(60):
            if all(inspect(s)['State'].get('Health',{}).get('Status')=='healthy' for s in ['backend','frontend']):break
            time.sleep(3)
        else:raise RuntimeError('API/UI health deadline exceeded')
        run('docker','exec','agent-os-nginx-1','nginx','-t')
        run('docker','exec','agent-os-nginx-1','nginx','-s','reload')
        for s in ['openclaw','content-converter','ollama']:
            if signature(s)!=state['services'][s]:raise RuntimeError('Unrelated service changed: '+s)
        # Do not overwrite parallel host edits; source merges were prepared separately.
        for p,h in state['checks'].items():
            if sha(root/p)!=h:raise RuntimeError('Concurrent host-source change during cutover: '+p)
        for p in sync_paths:
            dest=root/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(release/'host-source'/p,dest)
        (release/'activated.ok').write_text('API/UI healthy; unrelated services unchanged\n')
        print('OBSERVER_DEPLOYED_HEALTHY '+revision)
    except Exception:
        for s in ['backend','frontend']:
            try:recreate(s,f'agent-os-{s}:observer-rollback-{revision}')
            except Exception:print('ROLLBACK_FAILED '+s)
        subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-s','reload'])
        raise
else:raise RuntimeError('Expected prepare or activate')
