"""Disposable Docker acceptance environment; never mounts an existing HA/Flolah volume."""
import json,pathlib,subprocess,uuid,sys
base=pathlib.Path(sys.argv[1]).resolve()
assert (base/'physical-edge/test/ha-live.mjs').is_file()
name='flolah-physical-test-'+uuid.uuid4().hex[:10]
network=name+'-net';ha=name+'-ha';runner=name+'-runner'
def run(*args,**kw):return subprocess.run(args,check=True,**kw)
before=set(subprocess.check_output(['docker','ps','-q'],text=True).split())
(base/'ha-config').mkdir()
(base/'ha-config/configuration.yaml').write_text('default_config:\n')
(base/'backend/package.json').write_text(json.dumps({'type':'module','dependencies':{'ws':'^8.0.0'}}))
try:
 run('docker','network','create',network,stdout=subprocess.DEVNULL)
 run('docker','run','-d','--name',ha,'--network',network,'--network-alias','ha','--memory','1536m','--cpus','1','--pids-limit','512','-v',str(base/'ha-config')+':/config','ghcr.io/home-assistant/home-assistant:stable',stdout=subprocess.DEVNULL)
 image=json.loads(subprocess.check_output(['docker','inspect',ha],text=True))[0]['Image']
 result=run('docker','run','--rm','--name',runner,'--network',network,'--network-alias','runner','--memory','768m','--cpus','1','-v',str(base)+':/work','-e','PHYSICAL_HA_TEST_URL=http://ha:8123','-e','PHYSICAL_HA_BROKER_HOST=runner','node:22-bookworm-slim','sh','-c','npm --prefix /work/backend install --ignore-scripts --no-audit --no-fund && npm --prefix /work/physical-edge ci --ignore-scripts --no-audit --no-fund && node /work/physical-edge/test/ha-live.mjs',capture_output=True,text=True,timeout=360)
 print(result.stdout)
 (base/'acceptance.txt').write_text(result.stdout)
 (base/'evidence.json').write_text(json.dumps({'homeAssistantImage':image,'privateNetwork':network,'noPublishedPorts':True,'boundedResources':True}))
except subprocess.CalledProcessError as e:
 print((e.stdout or '')[-4000:]);print((e.stderr or '')[-4000:]);raise
finally:
 subprocess.run(['docker','rm','-f',runner,ha],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['docker','network','rm',network],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 after=set(subprocess.check_output(['docker','ps','-q'],text=True).split())
 assert before==after,'Existing running container set changed'
 print('Existing running containers preserved; isolated test containers and network removed.')
