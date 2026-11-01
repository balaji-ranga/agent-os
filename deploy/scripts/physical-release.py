"""Scoped Phase 1 rollout from captured runtime sources, preserving concurrent work."""
import json,pathlib,subprocess,shutil,sys,time,hashlib,os
root=pathlib.Path('/opt/agent-os');release=pathlib.Path(sys.argv[2]).resolve();mode=sys.argv[1]
assert release.parent==root/'releases'
context=release/'context'
def run(*args,**kw):return subprocess.run(args,check=True,**kw)
def inspect(service):return json.loads(subprocess.check_output(['docker','inspect','agent-os-'+service+'-1']))[0]
def signature(service):
 d=inspect(service);return [d['Id'],d['Image'],d['State']['StartedAt']]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
def merge(path,current):
 wanted=release/'files'/path;base=release/'base'/path
 if not current.exists():return wanted.read_bytes()
 actual=current.read_bytes().replace(b'\r\n',b'\n');desired=wanted.read_bytes().replace(b'\r\n',b'\n');before=base.read_bytes().replace(b'\r\n',b'\n')
 if actual==desired:return desired
 if not before:raise RuntimeError('New source collision: '+path)
 temporary=release/'merge-current';temporary.write_bytes(actual);b=release/'merge-base';b.write_bytes(before);w=release/'merge-wanted';w.write_bytes(desired)
 merged=subprocess.run(['git','merge-file','-p',str(temporary),str(b),str(w)],capture_output=True)
 if merged.returncode: (release/'merge-conflict.txt').write_bytes(merged.stdout);raise RuntimeError('Overlapping source change: '+path)
 return merged.stdout
changes=json.loads((release/'manifest.json').read_text())['changes']
if mode=='prepare':
 assert not context.exists();(context/'backend').mkdir(parents=True)
 state={'services':{s:signature(s) for s in ['backend','frontend','openclaw','ollama']},'configs':{},'checks':{},'images':{}}
 for service in ['backend','frontend']:
  d=inspect(service);state['configs'][service]=d['Config']['Labels']['com.docker.compose.project.config_files'];state['images'][service]=d['Config']['Image']
  state[service+'Env']={e.split('=',1)[0]:e.split('=',1)[1] for e in d['Config']['Env']}
 for part in ['src','scripts','package.json','package-lock.json']:run('docker','cp','agent-os-backend-1:/opt/agent-os/backend/'+part,str(context/'backend'/part))
 source=pathlib.Path('/opt/agent-os-releases/partial-goal-v59-20261029/source/frontend')
 assert inspect('frontend')['Config']['Image']=='agent-os-frontend:partial-goal-v59-20261029','Re-resolve frontend source after competing deployment'
 shutil.copytree(source,context/'frontend',ignore=shutil.ignore_patterns('node_modules','dist','.env*','.git'))
 for kind,path in changes:
  state['checks'][path]=sha(root/path)
  if path.startswith('backend/') or path.startswith('frontend/'):
   target=context/path;payload=merge(path,target)
  elif path=='deploy/nginx/nginx.host-network.conf':target=context/path;payload=merge(path,root/path)
  else:target=context/path;payload=(release/'files'/path).read_bytes()
  target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(payload)
 # Regenerate UI metadata from the merged deployed source.
 run('docker','run','--rm','--cpus=2','--memory=3g','-v',str(context)+':/work','-w','/work/frontend','node:22-bookworm-slim','sh','-c','npm ci --ignore-scripts && node scripts/generate-copilot-screen-inventory.mjs && npm run build')
 backend=("FROM "+state['images']['backend']+"\nWORKDIR /opt/agent-os/backend\nCOPY backend/src ./src\nCOPY backend/scripts/test-physical-integration.mjs ./scripts/\nRUN npm install --omit=dev --ignore-scripts --no-audit --no-fund ws@8.22.1\nCOPY physical-edge/dist /opt/agent-os/physical-edge/dist\nCOPY docs-site/docs /opt/agent-os/docs-site/docs\nLABEL org.flolah.physical.release=\""+str(release)+"\"\n")
 (context/'backend.release.Dockerfile').write_text(backend)
 frontend="FROM "+state['images']['frontend']+"\nCOPY frontend/dist /usr/share/nginx/html\nLABEL org.flolah.physical.source-context=\""+str(context)+"\"\n"
 (context/'frontend.release.Dockerfile').write_text(frontend)
 for service in ['backend','frontend']:run('docker','build','-f',str(context/(service+'.release.Dockerfile')),'-t','agent-os-'+service+':physical-phase1',str(context))
 run('docker','run','--rm','--network','none','agent-os-backend:physical-phase1','node','--check','src/index.js')
 run('docker','run','--rm','--cpus=1','--memory=1g','agent-os-backend:physical-phase1','node','scripts/test-physical-integration.mjs')
 state['backendEnv']['FLOLAH_PHYSICAL_ENABLED']='1'
 (release/'captured.json').write_text(json.dumps(state));(release/'captured.json').chmod(0o600)
 (release/'prepared.ok').write_text('Build and authorization harness passed')
 print('PHYSICAL_RELEASE_PREPARED')
elif mode=='activate':
 state=json.loads((release/'captured.json').read_text());assert (release/'prepared.ok').exists() and not (release/'activated.ok').exists()
 for service,sig in state['services'].items():assert signature(service)==sig,'Concurrent deployment '+service
 for path,value in state['checks'].items():assert sha(root/path)==value,'Concurrent source edit '+path
 def recreate(service,image,enabled=True):
  env=dict(state[service+'Env']);
  if service=='backend' and not enabled:env.pop('FLOLAH_PHYSICAL_ENABLED',None)
  overlay=release/(service+('-active' if enabled else '-rollback')+'.json');overlay.write_text(json.dumps({'services':{service:{'image':image,'environment':env}}}));overlay.chmod(0o600)
  args=['docker','compose','-p','agent-os']
  for file in state['configs'][service].split(','):args+=['-f',file]
  run(*args,'-f',str(overlay),'up','-d','--no-build','--no-deps','--force-recreate',service,cwd=root/'deploy',stdout=subprocess.DEVNULL)
 proxy=root/'deploy/nginx/nginx.host-network.conf';shutil.copy2(proxy,release/'nginx-before.conf')
 run('docker','exec','-e','PHYSICAL_BACKUP=/tmp/physical-before.db','agent-os-backend-1','node','--input-type=module','-e','import Database from "better-sqlite3";import {join} from "node:path";const db=new Database(join(process.env.AGENT_OS_DATA_DIR||"/opt/agent-os/backend/data","agent-os.db"),{readonly:true,fileMustExist:true});await db.backup(process.env.PHYSICAL_BACKUP);db.close();')
 run('docker','cp','agent-os-backend-1:/tmp/physical-before.db',str(release/'database-before.db'));(release/'database-before.db').chmod(0o600)
 try:
  # Write through the existing bind-mounted inode rather than replacing its path.
  proxy.write_bytes((context/'deploy/nginx/nginx.host-network.conf').read_bytes())
  run('docker','exec','agent-os-nginx-1','nginx','-t')
  for service in ['backend','frontend']:recreate(service,'agent-os-'+service+':physical-phase1')
  for _ in range(40):
   if all(inspect(s)['State'].get('Health',{}).get('Status')=='healthy' for s in ['backend','frontend']):break
   time.sleep(2)
  else:raise RuntimeError('Health deadline exceeded')
  run('docker','exec','agent-os-nginx-1','nginx','-s','reload')
  for service in ['openclaw','ollama']:assert signature(service)==state['services'][service],'Unrelated container changed'
  for _,path in changes:
   target=root/path
   if target.exists():previous=release/'source-before'/path;previous.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(target,previous)
   target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(context/path,target)
  (release/'activated.ok').write_text('Healthy; physical pilot enabled')
  print('PHYSICAL_RELEASE_HEALTHY')
 except Exception:
  proxy.write_bytes((release/'nginx-before.conf').read_bytes())
  for service in ['backend','frontend']:recreate(service,state['images'][service],False)
  subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-s','reload']);raise
else:raise RuntimeError('Use prepare or activate')
