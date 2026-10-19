"""Scoped checker release. Keep existing images/configuration and parallel work.

Run prepare against a source release directly under the independent release
directory; activate only after its isolated tests and model comparison. Source
archive is trusted build input; never include environment files or credentials.
"""
import argparse,json,pathlib,subprocess,os,time,tarfile
p=argparse.ArgumentParser(description=__doc__);p.add_argument('mode',choices=['prepare','activate']);p.add_argument('release',type=pathlib.Path);p.add_argument('--gateway-only',action='store_true',help='Retain already deployed API/UI images for a review-contract-only update');a=p.parse_args();r=a.release.resolve()
if r.parent!=pathlib.Path('/opt/flolah-digital-adoption/releases') or not r.name.replace('-','').replace('_','').isalnum():p.error('Unexpected release directory')
rev=r.name;statefile=r/'release-state.json'
def inspect(n):return json.loads(subprocess.check_output(['docker','inspect',n]))[0]
def run(cmd,log=None,**kw):
 result=subprocess.run(cmd,capture_output=True,text=True,**kw)
 if log:(r/log).write_text(result.stdout+result.stderr)
 if result.returncode:raise RuntimeError('Release step failed: '+(log or cmd[0]))
 return result.stdout
def ident(n):
 d=inspect(n);labels=d['Config']['Labels'];return {'id':d['Id'],'imageId':d['Image'],'tag':d['Config']['Image'],'files':labels['com.docker.compose.project.config_files'].split(','),'directory':labels['com.docker.compose.project.working_dir'],'project':labels['com.docker.compose.project']}
names={'backend':'agent-os-backend-1','frontend':'agent-os-frontend-1','gateway':'flolah-adoption-adoption-model-gateway-1','coordinator':'flolah-adoption-adoption-1'}
def compose(key,state,tag):
 identity=state['before'][key];project=identity['project'];service={'gateway':'adoption-model-gateway'}.get(key,key)
 override=r/(key+'.override.json');override.write_text(json.dumps({'services':{service:{'image':tag}}}))
 cmd=['docker','compose','-p',project]
 if key!='gateway':cmd+=['--env-file','/opt/agent-os/deploy/.env','--profile','optional-ollama']
 for f in identity['files']:cmd+=['-f',f]
 cmd+=['-f',str(override)]
 env=os.environ|{'ADOPTION_ROOT':'/opt/flolah-digital-adoption','ADOPTION_RELEASE':'20261019-checker-timeout'}
 rendered=json.loads(run(cmd+['config','--format','json'],cwd=identity['directory'],env=env))['services'][service]
 d=inspect(names[key]);current=dict(x.split('=',1) for x in d['Config']['Env'] if '=' in x)
 if any(str(v)!=current.get(k) for k,v in rendered.get('environment',{}).items()):raise RuntimeError('Unrelated environment drift; prepare a fresh release')
 run(cmd+['up','-d','--no-deps','--pull','never',service],log=key+'-activate.log',cwd=identity['directory'],env=env)
if a.mode=='prepare':
 if statefile.exists():raise RuntimeError('Release already prepared; use a fresh revision')
 if (r/'source.tar.gz').exists():
  with tarfile.open(r/'source.tar.gz') as archive:
   for item in archive.getmembers():
    if not (r/item.name).resolve().is_relative_to(r):raise RuntimeError('Unsafe source archive')
   archive.extractall(r,filter='data')
 state={'revision':rev,'before':{k:ident(v) for k,v in names.items()},'images':{'gateway':'flolah-digital-adoption:'+rev,'backend':'agent-os-backend:'+rev,'frontend':'agent-os-frontend:'+rev}}
 if a.gateway_only:
  for key in ['backend','frontend']:state['images'][key]=state['before'][key]['tag']
 # Capture immutable bases; no pull/latest upgrade and no in-container edits.
 for key,dockerfile,base in [('gateway','digital-adoption/deploy/checker-runtime.Dockerfile','coordinator'),('backend','deploy/docker/backend.checker.Dockerfile','backend'),('frontend','deploy/docker/frontend.checker.Dockerfile','frontend')]:
  if a.gateway_only and key!='gateway':continue
  print(json.dumps({'phase':'build','service':key}),flush=True)
  baseTag='flolah-checker-base:'+rev+'-'+base
  run(['docker','tag',state['before'][base]['imageId'],baseTag])
  run(['docker','build','--build-arg','BASE_IMAGE='+baseTag,'--build-arg','RELEASE_REVISION='+rev,'-f',str(r/dockerfile),'-t',state['images'][key],str(r)],log=key+'-build.log')
 print(json.dumps({'phase':'test','suite':'service'}),flush=True)
 # Test only synthetic in-container loopback services. No production data mount.
 out=run(['docker','run','--rm','--network','none','--entrypoint','sh','-v',str(r/'digital-adoption/test')+':/adoption/test:ro','-v',str(r/'digital-adoption/deploy')+':/adoption/deploy:ro',state['images']['gateway'],'-c','node --test --test-concurrency=2 test/*.test.mjs'],log='service-tests.log')
 print('\n'.join(out.splitlines()[-9:]),flush=True)
 print(json.dumps({'phase':'test','suite':'admin'}),flush=True)
 run(['docker','run','--rm','--network','none','--entrypoint','node','-v',str(r/'backend/scripts/test-copilot-quality-settings.mjs')+':/opt/agent-os/backend/scripts/test-copilot-quality-settings.mjs:ro',state['images']['backend'],'scripts/test-copilot-quality-settings.mjs'],log='admin-tests.log')
 statefile.write_text(json.dumps(state,indent=2));os.chmod(statefile,0o600);print(json.dumps({'phase':'prepared','images':state['images']}),flush=True)
else:
 state=json.loads(statefile.read_text());
 for key,name in names.items():
  if ident(name)!=state['before'][key]:raise RuntimeError('Concurrent deployment: prepare a fresh release')
 allBefore={n:inspect(n)['Id'] for n in run(['docker','ps','--format','{{.Names}}']).splitlines()}
 done=[]
 try:
  for key in ['gateway','backend','frontend']:
   if state['images'][key]!=state['before'][key]['tag']:compose(key,state,state['images'][key]);done.append(key)
  run(['docker','exec','agent-os-nginx-1','nginx','-t']);run(['docker','exec','agent-os-nginx-1','nginx','-s','reload'])
  for _ in range(60):
   if all(inspect(names[k])['State']['Status']=='running' and inspect(names[k])['State'].get('Health',{}).get('Status') in [None,'healthy'] for k in ['gateway','backend','frontend']):break
   time.sleep(1)
  else:raise RuntimeError('Readiness failed')
  for url in ['http://127.0.0.1:4195/health','https://login.flolah.cloud/api/health','https://login.flolah.cloud/']:
   run(['curl','--fail','--max-time','15','-s','-o','/dev/null',url])
  changed=[n for n,i in allBefore.items() if inspect(n)['Id']!=i]
  if set(changed)-set(names[k] for k in ['gateway','backend','frontend']):raise RuntimeError('Unrelated containers changed')
  result={'phase':'active','revision':rev,'changedContainers':changed,'coordinatorAndWorkersUnchanged':True,'modelSelectionChanged':False};(r/'activation.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
 except Exception:
  for key in reversed(done):compose(key,state,state['before'][key]['tag'])
  run(['docker','exec','agent-os-nginx-1','nginx','-t']);run(['docker','exec','agent-os-nginx-1','nginx','-s','reload']);raise
