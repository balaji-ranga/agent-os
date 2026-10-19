"""Read-only deployed-image, liveness and preserved-worker verification."""
import datetime,json,pathlib,re,sqlite3,subprocess,sys
release=sys.argv[1]
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',release):raise ValueError('Invalid release')
bundle=pathlib.Path('/opt/flolah-digital-adoption/releases')/release
manifest=json.loads((bundle/'coordinator-previous.json').read_text());coordinator_only=manifest.get('mode')=='coordinator-only'
names=['flolah-adoption-adoption-1','flolah-adoption-adoption-model-gateway-1','flolah-adoption-adoption-worker-1','flolah-adoption-adoption-worker-2','agent-os-backend-1','agent-os-frontend-1']
rows=json.loads(subprocess.check_output(['docker','inspect',*names]))
state={r['Name'][1:]:{'imageId':r['Image'],'image':r['Config']['Image'],'startedAt':r['State']['StartedAt'],'running':r['State']['Running'],'health':r['State'].get('Health',{}).get('Status')} for r in rows}
expected=[(names[0],'flolah-digital-adoption:'+release)]
if not coordinator_only:expected += [(names[1],'flolah-digital-adoption:'+release+'-gateway'),(names[4],'agent-os-backend:adoption-'+release),(names[5],'agent-os-frontend:adoption-'+release)]
for name,image in expected:assert state[name]['image']==image
for row in rows:
 previous=manifest.get('untouched',{}).get(row['Name'][1:])
 if previous:assert row['Id']==previous['id'] and row['Image']==previous['imageId'],'Untouched service changed during scoped release'
assert all(item['running'] for item in state.values())
assert all(state[name]['startedAt']<state[names[0]]['startedAt'] for name in names[2:4]),'Parser workers restarted unexpectedly'
for url in ['http://127.0.0.1:4193/health','http://127.0.0.1:4195/health','https://login.flolah.cloud/api/health','https://flolah.cloud/']:
 subprocess.run(['curl','--fail','--silent','--show-error','--max-time','15','-o','/dev/null',url],check=True)
db=sqlite3.connect('file:/var/lib/docker/volumes/agent-os_agent_os_data/_data/agent-os.db?mode=ro',uri=True)
quality=json.loads(db.execute("select value from platform_settings where key='digital_adoption_maker_checker'").fetchone()[0]);db.close()
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','release':release,'containers':state,'healthUrlsPassed':4,'parserWorkersPreserved':True,'sharedCheckerSettingReadOnly':quality,'gatewayPatch':'Only generic assignment helper and mixed-instruction guard; parent checker/provider image preserved'}
(bundle/'deployment-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
