"""Prepare/activate a retention-only image against the captured live runtime.

The extracted release includes desired files, _base copies from its Git base,
tests and this helper. Merge concurrent edits; preserve untouched runtime files.
No model configuration, worker count, website policy or preview is changed.
"""
import argparse, json, os, pathlib, shutil, subprocess, time, urllib.request

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('mode',choices=['prepare','activate'])
parser.add_argument('release',type=pathlib.Path)
args=parser.parse_args();release=args.release.resolve();root=pathlib.Path('/opt/flolah-digital-adoption')
if release.parent!=root/'releases':parser.error('Release must be directly under the deployment releases directory')
revision=release.name
if not revision or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in revision):parser.error('Invalid revision')
paths=['src/opensearch.mjs','src/private-task-search.mjs','src/private-tasks.mjs','src/runtime.mjs','web/session-client.mjs','web/task-panel.mjs','web/widget.mjs']
container='flolah-adoption-adoption-1';image='flolah-digital-adoption:'+revision
def run(*cmd,**kw):return subprocess.run(cmd,check=True,**kw)
def inspect():return json.loads(subprocess.check_output(['docker','inspect',container]))[0]
def identity(value):return {key:value[key] for key in ['Id','Image']}|{'tag':value['Config']['Image'],'started':value['State']['StartedAt']}
env=os.environ|{'ADOPTION_ROOT':str(root),'ADOPTION_RELEASE':revision}
def recreate(tag,state):
 override=release/'runtime-override.json';override.write_text(json.dumps({'services':{'adoption':{'image':tag}}}))
 cmd=['docker','compose','-p','flolah-adoption']
 for path in state['compose'].split(','):cmd+=['-f',path]
 cmd+=['-f',str(override),'up','-d','--no-deps','--no-build','--force-recreate','adoption'];run(*cmd,env=env)
 for _ in range(60):
  try:
   with urllib.request.urlopen('http://127.0.0.1:4193/health',timeout=2) as response:
    if response.status==200 and inspect()['Config']['Image']==tag:return
  except Exception:pass
  time.sleep(1)
 raise RuntimeError('Independent service health check failed')

if args.mode=='prepare':
 if (release/'context').exists():raise RuntimeError('Use a fresh revision for every candidate')
 current=inspect();state={'identity':identity(current),'compose':current['Config']['Labels']['com.docker.compose.project.config_files']}
 context=release/'context';context.mkdir()
 for name in paths:
  dest=context/name;dest.parent.mkdir(parents=True,exist_ok=True);live=release/'captured'/name;live.parent.mkdir(parents=True,exist_ok=True)
  base=release/'_base'/name;desired=(release/name).read_bytes().replace(b'\r\n',b'\n')
  if base.exists():
   run('docker','cp',container+':/adoption/'+name,str(live),stdout=subprocess.DEVNULL)
   old=base.read_bytes().replace(b'\r\n',b'\n');actual=live.read_bytes().replace(b'\r\n',b'\n')
   if actual==old or actual==desired:merged=desired
   else:
    original=release/'merge-base';original.write_bytes(old);incoming=release/'merge-incoming';incoming.write_bytes(desired);live.write_bytes(actual)
    merged=subprocess.check_output(['git','merge-file','-p',str(live),str(original),str(incoming)])
  else:merged=desired
  dest.write_bytes(merged)
 dockerfile=context/'deploy/private-retention.Dockerfile';dockerfile.parent.mkdir();shutil.copy2(release/'deploy/private-retention.Dockerfile',dockerfile)
 base_tag='flolah-digital-adoption:retention-base-'+revision;run('docker','tag',state['identity']['tag'],base_tag)
 run('docker','build','--build-arg','BASE_IMAGE='+base_tag,'-f',str(dockerfile),'-t',image,str(context))
 test_mount=['-v',str(release/'test')+':/adoption/test:ro','-v',str(release/'deploy')+':/adoption/deploy:ro']
 with (release/'regressions.log').open('w') as log:
  run('docker','run','--rm','--network','none','--cpus','1','--memory','1g',*test_mount,image,'sh','-c','node --test test/*.test.mjs',stdout=log,stderr=subprocess.STDOUT)
 with (release/'live-retention.json').open('w') as log:
  run('docker','run','--rm','--network','agent-os_default','--cpus','1','--memory','1g','-v',str(root/'config/service.json')+':/config/service.json:ro',*test_mount,image,'node','test/private-retention-live.mjs',stdout=log)
 (release/'captured.json').write_text(json.dumps(state));(release/'prepared.ok').write_text('Prepared\n');print('PRIVATE_RETENTION_PREPARED '+revision)
else:
 if not (release/'prepared.ok').exists() or (release/'activated.ok').exists():raise RuntimeError('Invalid activation state')
 state=json.loads((release/'captured.json').read_text())
 if identity(inspect())!=state['identity']:raise RuntimeError('Concurrent deployment detected; prepare a fresh candidate')
 run('docker','run','--rm','--network','none','--entrypoint','node','-v',str(root/'data')+':/data','-v',str(release)+':/release:ro',state['identity']['tag'],'/release/deploy/checkpoint.mjs',revision)
 try:recreate(image,state)
 except Exception:
  if inspect()['Config']['Image']==image:recreate(state['identity']['tag'],state)
  raise
 (release/'activated.ok').write_text('Healthy\n');print('PRIVATE_RETENTION_DEPLOYED '+revision)
