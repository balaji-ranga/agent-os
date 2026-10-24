"""Apply only a tested coordinator image; preserve gateway/workers and concurrent releases."""
import json, os, pathlib, re, subprocess, sys, time

release = sys.argv[1]
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', release):
    raise ValueError('Invalid release')
bundle = pathlib.Path('/opt/flolah-digital-adoption/releases') / release
manifest = json.loads((bundle / 'coordinator-previous.json').read_text())
coordinator_only=manifest.get('mode')=='coordinator-only'
image = 'flolah-digital-adoption:' + release
subprocess.run(['docker', 'image', 'inspect', image], check=True, stdout=subprocess.DEVNULL)
current = json.loads(subprocess.check_output(['docker', 'inspect', 'flolah-adoption-adoption-1']))[0]
if current['Image'] != manifest['imageId']:
    raise ValueError('Coordinator changed during preparation; rebuild on the new image')
gateway_manifest=json.loads((bundle/'gateway-previous.json').read_text())
gateway=json.loads(subprocess.check_output(['docker','inspect','flolah-adoption-adoption-model-gateway-1']))[0]
if gateway['Image']!=gateway_manifest['imageId']:raise ValueError('Parallel gateway changed; rebuild on its new image before activating')
if not coordinator_only:subprocess.run(['docker','image','inspect',image+'-gateway'],check=True,stdout=subprocess.DEVNULL)
# Resolve the budget before any service change, preserving an existing override.
prior_context=next((entry.split('=',1)[1] for entry in current['Config'].get('Env',[]) if entry.startswith('ADOPTION_MODEL_CONTEXT_BYTES=')),None)
raw=os.environ.get('ADOPTION_MODEL_CONTEXT_BYTES',prior_context)
if raw is not None and (not re.fullmatch('[0-9]+',raw) or not 16000<=int(raw)<=128000):raise ValueError('Invalid model context budget')
probe=['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--entrypoint','node']
if raw is not None:probe+=['-e','ADOPTION_MODEL_CONTEXT_BYTES='+raw]
export_budget="import{MODEL_CONTEXT_BYTES}from'/adoption/src/model-context-budget.mjs';console.log(MODEL_CONTEXT_BYTES)"
resolved=subprocess.check_output(probe+[image,'--input-type=module','-e',export_budget],text=True).strip()
context_environment={'ADOPTION_MODEL_CONTEXT_BYTES':resolved}
if coordinator_only:
    gateway_budget=subprocess.check_output(['docker','exec','flolah-adoption-adoption-model-gateway-1','node','--input-type=module','-e',export_budget],text=True).strip()
    if gateway_budget!=resolved:raise ValueError('Context budget change requires a paired coordinator/gateway release')
subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--user', '1000:1000', '--entrypoint', 'node',
                '-v', '/opt/flolah-digital-adoption/data:/data', '-v', str(bundle)+':/release:ro',
                manifest['imageId'], '/release/deploy/checkpoint.mjs', release], check=True)
override = bundle / 'coordinator.override.yml'
override.write_text(json.dumps({'services': {'adoption': {'image': image,**({'environment':context_environment} if context_environment else {})}}}))
files = manifest['composeFiles'].split(',') + [str(override)]
command = ['docker', 'compose', '-p', 'flolah-adoption']
for file in dict.fromkeys(files):
    command += ['-f', file]
environment = dict(os.environ, ADOPTION_ROOT='/opt/flolah-digital-adoption', ADOPTION_RELEASE=release)
subprocess.run(command + ['up', '-d', '--no-deps', '--no-build', 'adoption'], check=True, env=environment)
for attempt in range(20):
    check = subprocess.run(['curl', '--fail', '--silent', 'http://127.0.0.1:4193/health'], capture_output=True)
    if check.returncode == 0:
        print('Scoped coordinator is healthy. Parser workers were not restarted; the captured gateway patch follows.')
        break
    time.sleep(1)
else:
    raise RuntimeError('Coordinator did not become healthy. Repair forward; do not bypass persisted action guards with a legacy rollback.')
if coordinator_only:
    print('Coordinator-only patch healthy. Gateway, platform and parser workers were not restarted.')
    sys.exit(0)
gateway_override=bundle/'gateway.override.yml'
gateway_override.write_text(json.dumps({'services':{'adoption-model-gateway':{'image':image+'-gateway',**({'environment':context_environment} if context_environment else {})}}}))
gateway_command=['docker','compose','-p','flolah-adoption']
for file in dict.fromkeys(gateway_manifest['composeFiles'].split(',')+[str(gateway_override)]):gateway_command+=['-f',file]
subprocess.run(gateway_command+['up','-d','--no-deps','--no-build','adoption-model-gateway'],check=True,env=environment)
for attempt in range(20):
    check=subprocess.run(['curl','--fail','--silent','http://127.0.0.1:4195/health'],capture_output=True)
    if check.returncode==0:break
    time.sleep(1)
else:raise RuntimeError('Gateway health deadline; inspect startup before continuing platform activation')
budgets=[subprocess.check_output(['docker','exec',name,'node','--input-type=module','-e',"import{MODEL_CONTEXT_BYTES}from'/adoption/src/model-context-budget.mjs';console.log(MODEL_CONTEXT_BYTES)"],text=True).strip() for name in ['flolah-adoption-adoption-1','flolah-adoption-adoption-model-gateway-1']]
if len(set(budgets))!=1:raise RuntimeError('Coordinator and gateway context budgets differ')
subprocess.run(['python3',str(bundle/'deploy/install-model-context-limit.py')],check=True)
print('Gateway keeps its captured parallel checker/provider base; only generic assignment guards changed. Parser workers and Admin model settings unchanged.')
