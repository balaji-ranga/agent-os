"""Build and test a scoped coordinator, then prepare the additive platform patch."""
import json, pathlib, re, subprocess, sys
release=sys.argv[1]
coordinator_only=sys.argv[2:]==['--coordinator-only']
if sys.argv[2:] and not coordinator_only:raise ValueError('Unsupported preparation option')
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',release):raise ValueError('Invalid release')
bundle=pathlib.Path('/opt/flolah-digital-adoption/releases')/release
manifest=bundle/'coordinator-previous.json'
if manifest.exists():raise ValueError('Candidate already prepared; use a fresh release')
current=json.loads(subprocess.check_output(['docker','inspect','flolah-adoption-adoption-1']))[0]
untouched={}
for name in ['flolah-adoption-adoption-worker-1','flolah-adoption-adoption-worker-2']+(['flolah-adoption-adoption-model-gateway-1','agent-os-backend-1','agent-os-frontend-1'] if coordinator_only else []):
 row=json.loads(subprocess.check_output(['docker','inspect',name]))[0];untouched[name]={'id':row['Id'],'imageId':row['Image'],'image':row['Config']['Image']}
manifest.write_text(json.dumps({'mode':'coordinator-only' if coordinator_only else 'full','untouched':untouched,'imageId':current['Image'],'image':current['Config']['Image'],'composeFiles':current['Config']['Labels']['com.docker.compose.project.config_files']}))
gateway=json.loads(subprocess.check_output(['docker','inspect','flolah-adoption-adoption-model-gateway-1']))[0]
(bundle/'gateway-previous.json').write_text(json.dumps({'imageId':gateway['Image'],'image':gateway['Config']['Image'],'composeFiles':gateway['Config']['Labels']['com.docker.compose.project.config_files']}))
base='flolah-immediate-base:'+release
subprocess.run(['docker','tag',current['Image'],base],check=True)
def run(args,name):
 with (bundle/name).open('w') as log:subprocess.run(args,check=True,stdout=log,stderr=subprocess.STDOUT)
run(['docker','build','--build-arg','BASE_IMAGE='+base,'-f',str(bundle/'deploy/immediate-phase.Dockerfile'),'-t','flolah-digital-adoption:'+release,str(bundle)],'coordinator-build.log')
gateway_base='flolah-immediate-gateway-base:'+release
subprocess.run(['docker','tag',gateway['Image'],gateway_base],check=True)
if not coordinator_only:run(['docker','build','--build-arg','BASE_IMAGE='+gateway_base,'-f',str(bundle/'deploy/immediate-gateway.Dockerfile'),'-t','flolah-digital-adoption:'+release+'-gateway',str(bundle)],'gateway-build.log')
run(['docker','build','--build-arg','BASE_IMAGE=flolah-digital-adoption:'+release,'-f',str(bundle/'deploy/immediate-test.Dockerfile'),'-t','flolah-immediate-tests:'+release,str(bundle)],'coordinator-tests-build.log')
run(['docker','run','--rm','--network','none','--entrypoint','sh','flolah-immediate-tests:'+release,'-c','node --test --test-concurrency=2 test/*.test.mjs'],'linux-tests.log')
print('Candidate Linux regression passed. No running services changed.',flush=True)
if coordinator_only:
 print('Coordinator-only candidate prepared; gateway, platform and parser workers stay untouched.',flush=True)
 sys.exit(0)
subprocess.run(['python3',str(bundle/'deploy/prepare-platform-connector.py'),str(bundle/'platform')],check=True)
run(['sh',str(bundle/'deploy/build-platform-connector.sh'),release],'platform-build.log')
print('Scoped coordinator and platform candidates prepared; activation is a separate step.',flush=True)
