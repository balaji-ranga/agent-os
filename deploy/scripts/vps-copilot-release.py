"""Three-way API/UI/guide release. No OpenClaw restart or credential changes.
prepare builds captured runtime sources; activate refuses concurrent changes.
"""
import json,pathlib,shutil,subprocess,sys,time,hashlib,re
root=pathlib.Path('/opt/agent-os');mode=sys.argv[1];release=pathlib.Path(sys.argv[2]).resolve()
if release.parent!=root/'releases':raise RuntimeError('Invalid release location')
manifest=json.loads((release/'manifest.json').read_text());revision=manifest['revision'];context=release/'context'
if not re.fullmatch(r'[-\w]+',revision):raise RuntimeError('Invalid revision')
changes=manifest['changes'];paths=[p for _,p in changes]
for p in paths:
 if pathlib.PurePosixPath(p).is_absolute() or '..' in pathlib.PurePosixPath(p).parts:raise RuntimeError('Unsafe path')
def run(*args,**kw):return subprocess.run(args,check=True,**kw)
def inspect(s):return json.loads(subprocess.check_output(['docker','inspect','agent-os-'+s+'-1']))[0]
def sig(s):
 d=inspect(s);return [d['Id'],d['Image'],d['State']['StartedAt']]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None
def merge(kind,p,current):
 desired=(release/'files'/p).read_bytes().replace(b'\r\n',b'\n')
 if kind=='A':
  if current.exists() and current.read_bytes().replace(b'\r\n',b'\n')!=desired:raise RuntimeError('New file collision '+p)
  return desired
 if not current.exists():raise RuntimeError('Missing source '+p)
 parts=[]
 for i,data in enumerate([desired,(release/'base'/p).read_bytes(),current.read_bytes()]):
  dest=release/f'merge-{i}.tmp';dest.write_bytes(data.replace(b'\r\n',b'\n'));parts.append(str(dest))
 result=subprocess.run(['git','merge-file','-p',*parts],capture_output=True)
 if result.returncode:raise RuntimeError('Merge conflict '+p)
 return result.stdout
if mode=='prepare':
 if context.exists():raise RuntimeError('Context already exists')
 (context/'backend').mkdir(parents=True);(context/'frontend').mkdir()
 state={'services':{s:sig(s) for s in ['backend','frontend','openclaw','ollama']},'checks':{p:digest(root/p) for p in paths},'configs':{s:inspect(s)['Config']['Labels']['com.docker.compose.project.config_files'] for s in ['backend','frontend']}}
 for s in ['backend','frontend']:run('docker','tag',state['services'][s][1],f'agent-os-{s}:copilot-rollback-{revision}')
 for part in ['src','scripts','package.json','package-lock.json']:run('docker','cp',f'agent-os-backend-1:/opt/agent-os/backend/{part}',str(context/'backend'/part))
 for part in ['openclaw-workspace-templates','knowledgebase']:run('docker','cp',f'agent-os-backend-1:/opt/agent-os/{part}',str(context/part))
 labels=inspect('frontend')['Config']['Labels'];source=labels.get('org.flolah.copilot.source-context') or labels.get('org.flolah.kanban-observer.source-context')
 if not source:
  old=labels.get('org.flolah.copilot.revision','')
  if not re.fullmatch(r'[-\w]+',old):raise RuntimeError('Missing running source label')
  source=str(root/'releases'/('copilot-'+old)/'context')
 if not (pathlib.Path(source)/'frontend').is_dir():raise RuntimeError('Missing running frontend source')
 shutil.copytree(pathlib.Path(source)/'frontend',context/'frontend',dirs_exist_ok=True,ignore=shutil.ignore_patterns('node_modules','dist','.env*'))
 for kind,p in changes:
  current=context/p
  if not p.startswith(('backend/','frontend/','knowledgebase/','openclaw-workspace-templates/')) and (root/p).exists():
   current.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/p,current)
  payload=merge(kind,p,current);current.parent.mkdir(parents=True,exist_ok=True);current.write_bytes(payload)
  host=release/'host-source'/p;host.parent.mkdir(parents=True,exist_ok=True);host.write_bytes(merge(kind,p,root/p))
 (context/'.dockerignore').write_text('**/node_modules\n**/dist\n**/.git\n**/.env*\n')
 # Regenerate inventories from the merged running UI, not a stale local tree.
 run('docker','run','--rm','-v',f'{context}:/release','-w','/release/frontend','node:22-bookworm-slim','sh','-c','npm ci && node scripts/generate-copilot-screen-inventory.mjs')
 for p in ['backend/src/generated/copilot-screen-inventory.json','frontend/src/generated/copilot-screen-inventory.json']:shutil.copy2(context/p,release/'host-source'/p)
 (context/'backend.release.Dockerfile').write_text(f'FROM agent-os-backend:copilot-rollback-{revision}\nCOPY backend /opt/agent-os/backend\nCOPY openclaw-workspace-templates /opt/agent-os/openclaw-workspace-templates\nCOPY knowledgebase/platform-help /opt/agent-os/knowledgebase/platform-help\nWORKDIR /opt/agent-os/backend\n')
 (context/'frontend.release.Dockerfile').write_text(f'FROM node:22-bookworm-slim AS build\nWORKDIR /app\nCOPY frontend/package*.json ./\nRUN npm ci\nCOPY frontend ./\nENV VITE_API_URL=/api\nRUN npm run test:chat && npm run build\nFROM agent-os-frontend:copilot-rollback-{revision}\nLABEL org.flolah.copilot.source-context="{context}"\nCOPY --from=build /app/dist /usr/share/nginx/html\n')
 for s in ['backend','frontend']:run('docker','build','-f',str(context/f'{s}.release.Dockerfile'),'-t',f'agent-os-{s}:copilot-{revision}',str(context))
 run('docker','run','--rm','--network','none',f'agent-os-backend:copilot-{revision}','npm','run','test:ui-copilot')
 (release/'captured.json').write_text(json.dumps(state));(release/'prepared.ok').write_text('Local container harness passed\n');print('COPILOT_PREPARED '+revision)
elif mode=='activate':
 if not (release/'prepared.ok').exists() or (release/'activated.ok').exists():raise RuntimeError('Invalid activation state')
 state=json.loads((release/'captured.json').read_text())
 for s,v in state['services'].items():
  if sig(s)!=v:raise RuntimeError('Concurrent deployment '+s)
 for p,v in state['checks'].items():
  if digest(root/p)!=v:raise RuntimeError('Concurrent source change '+p)
 for p in paths:
  if (root/p).exists():dest=release/'source-before'/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/p,dest)
 run('docker','exec','-e',f'COPILOT_BACKUP=/tmp/copilot-{revision}.db','agent-os-backend-1','node','--input-type=module','-e','import {getDb} from "./src/db/schema.js";await getDb().backup(process.env.COPILOT_BACKUP);')
 run('docker','cp',f'agent-os-backend-1:/tmp/copilot-{revision}.db',str(release/'database-before.db'));(release/'database-before.db').chmod(0o600)
 def recreate(s,image):
  override=release/(s+'.override.yml');override.write_text(f'services:\n  {s}:\n    image: {image}\n');args=['docker','compose','-p','agent-os']
  for f in state['configs'][s].split(','):args+=['-f',f]
  run(*args,'-f',str(override),'up','-d','--no-deps','--no-build','--force-recreate',s,cwd=root/'deploy')
 try:
  for s in ['backend','frontend']:recreate(s,f'agent-os-{s}:copilot-{revision}')
  for attempt in range(60):
   if all(inspect(s)['State'].get('Health',{}).get('Status')=='healthy' for s in ['backend','frontend']):break
   time.sleep(3)
  else:raise RuntimeError('Health deadline exceeded')
  for p in paths:dest=root/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(release/'host-source'/p,dest)
  run('docker','exec','agent-os-nginx-1','nginx','-t');run('docker','exec','agent-os-nginx-1','nginx','-s','reload')
  for s in ['openclaw','ollama']:
   if sig(s)!=state['services'][s]:raise RuntimeError('Unrelated service changed '+s)
  (release/'activated.ok').write_text('Healthy\n');print('COPILOT_DEPLOYED_HEALTHY '+revision)
 except Exception:
  for p in paths:
   previous=release/'source-before'/p
   if previous.exists():shutil.copy2(previous,root/p)
  for s in ['backend','frontend']:recreate(s,f'agent-os-{s}:copilot-rollback-{revision}')
  subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-t']);subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-s','reload']);raise
else:raise RuntimeError('Expected prepare or activate')
