import pathlib,subprocess,json,time,argparse,os
parser=argparse.ArgumentParser(description="Deploy manifest-verified FloAssist images without touching unrelated services")
parser.add_argument("--release-dir",required=True);parser.add_argument("--image-tag",required=True);parser.add_argument("--root",default=os.environ.get("AGENT_OS_ROOT","/opt/agent-os"));parser.add_argument("--startup-timeout",type=int,default=600)
options=parser.parse_args();root=pathlib.Path(options.root)
release=pathlib.Path(options.release_dir).resolve();release.mkdir(parents=True,exist_ok=True)
accepted=json.loads((release/'build-accepted.json').read_text());verified=json.loads((release/'source-verification.json').read_text());assert accepted['revision']==verified['revision'] and not verified['mismatches']
keys=['backend','openclaw','frontend'];live={k:json.loads(subprocess.check_output(['docker','inspect','agent-os-'+k+'-1']))[0] for k in keys}
previous=json.loads((release/'rollback.json').read_text());assert all(live[k]['Config']['Image']==previous[k] for k in keys),'Running services changed during validation; reconcile before cutover'
files=live['backend']['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
override=release/'compose.yml';override.write_text('services:\n'+''.join('  '+k+':\n    image: agent-os-'+k+':'+options.image_tag+'\n' for k in keys))
base=['docker','compose','-p','agent-os','--env-file',str(root/'deploy/.env')]
for file in files:base+=['-f',file]
args=base+['-f',str(override)]
changed=[]
def invoke(command,name):
 with (release/name).open('a') as log:subprocess.run(command,cwd=root/'deploy',stdout=log,stderr=subprocess.STDOUT,check=True)
def healthy(key):
 for _ in range(max(1,options.startup_timeout//2)):
  value=subprocess.check_output(['docker','inspect','agent-os-'+key+'-1','--format','{{.State.Health.Status}}']).decode().strip()
  if value=='healthy':return
  time.sleep(2)
 raise RuntimeError(key+' did not become healthy')
try:
 for key in keys:
  print('SCOPED_CUTOVER',key,flush=True);changed.append(key);invoke(args+['up','-d','--no-deps','--no-build','--force-recreate',key],'cutover.log');healthy(key);print('HEALTHY',key,flush=True);invoke(['docker','exec','agent-os-nginx-1','nginx','-s','reload'],'cutover.log')
 invoke(['docker','exec','agent-os-openclaw-1','node','/opt/agent-os/scripts/verify-openclaw-extension-integrity.mjs'],'extension-integrity.log')
 invoke(['docker','exec','agent-os-nginx-1','nginx','-t'],'cutover.log');invoke(['docker','exec','agent-os-nginx-1','nginx','-s','reload'],'cutover.log')
 (release/'deployed.json').write_text(json.dumps({'revision':accepted['revision'],'services':keys,'healthy':True,'sourceFiles':verified['files'],'scope':'affected services only; no live model goals triggered'}))
 print('SCOPED_DEPLOYED_HEALTHY',accepted['revision'],flush=True)
except Exception:
 for key in changed:
  captured=release/(key+'-failed-startup.log')
  with captured.open('w') as log:subprocess.run(['docker','logs','--tail','250','agent-os-'+key+'-1'],stdout=log,stderr=subprocess.STDOUT)
  captured.chmod(0o600)
 rollback=release/'rollback-compose.yml';rollback.write_text('services:\n'+''.join('  '+k+':\n    image: '+previous[k]+'\n' for k in keys))
 invoke(base+['-f',str(rollback),'up','-d','--no-deps','--no-build','--force-recreate']+changed,'rollback.log');invoke(['docker','exec','agent-os-nginx-1','nginx','-s','reload'],'rollback.log');
 for key in changed:healthy(key)
 raise
