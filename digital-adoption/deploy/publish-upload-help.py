"""Publish only updated upload guidance, preserving the current backend code image."""
import json,pathlib,re,subprocess,sys,time
release=sys.argv[1]
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',release):raise ValueError('Invalid release')
bundle=pathlib.Path('/opt/flolah-digital-adoption/releases')/release
backend=json.loads(subprocess.check_output(['docker','inspect','agent-os-backend-1']))[0]
context=bundle/'upload-help';context.mkdir()
paths=['knowledgebase/platform-help/64-digital-adoption-websites.md','docs-site/docs/systems/digital-adoption.md']
for name in paths:
 live=context/(name+'.live');live.parent.mkdir(parents=True,exist_ok=True)
 live.write_bytes(subprocess.check_output(['docker','exec','agent-os-backend-1','cat','/opt/agent-os/'+name]))
 merged=subprocess.run(['git','merge-file','-p',str(live),str(bundle/'platform/base'/name),str(bundle/'platform/incoming'/name)],capture_output=True)
 if merged.returncode:raise ValueError('Upload help source merge conflict: '+name)
 (context/name).write_bytes(merged.stdout)
(context/'Dockerfile').write_text('FROM '+backend['Config']['Image']+'\n'+''.join('COPY '+name+' /opt/agent-os/'+name+'\n' for name in paths))
image='agent-os-backend:adoption-help-'+release
subprocess.run(['docker','build','-t',image,str(context)],check=True)
current=json.loads(subprocess.check_output(['docker','inspect','agent-os-backend-1']))[0]
if current['Image']!=backend['Image']:raise ValueError('Backend changed during help build; rebuild against its new image')
override=context/'help.override.yml';override.write_text(json.dumps({'services':{'backend':{'image':image}}}))
command=['docker','compose','-p','agent-os']
for file in dict.fromkeys(backend['Config']['Labels']['com.docker.compose.project.config_files'].split(',')+[str(override)]):command+=['-f',file]
subprocess.run(command+['up','-d','--no-deps','--no-build','backend'],check=True)
for attempt in range(30):
 result=subprocess.run(['curl','--fail','--silent','--max-time','5','-o','/dev/null','https://login.flolah.cloud/api/health'])
 if not result.returncode:break
 time.sleep(1)
else:raise RuntimeError('Backend help-only image health check failed')
subprocess.run(['python3',str(bundle/'deploy/publish-immediate-help.py'),release],check=True)
print('Owner-only knowledge and private-upload guidance indexed; backend code, frontend and model settings preserved.')
