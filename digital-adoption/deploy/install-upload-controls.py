"""Validate a scoped proxy candidate, then install upload limits without changing other routes."""
import hashlib,json,pathlib,re,subprocess,sys,tempfile
release=sys.argv[1]
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',release):raise ValueError('Invalid release')
bundle=pathlib.Path('/opt/flolah-digital-adoption/releases')/release
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
coordinator=inspect('flolah-adoption-adoption-1');proxy=inspect('agent-os-nginx-1')
previous=json.loads((bundle/'coordinator-previous.json').read_text())
if coordinator['Image']!=previous['imageId'] and coordinator['Config']['Image']!='flolah-digital-adoption:'+release:raise ValueError('Coordinator changed during preparation')
if proxy['HostConfig']['NetworkMode']!='host':raise ValueError('Review non-host proxy before trusting a forwarding hop')
bindings=coordinator['HostConfig']['PortBindings'].get('4193/tcp',[])
if bindings!=[{'HostIp':'127.0.0.1','HostPort':'4193'}]:raise ValueError('Expected loopback-only API binding')
gateways={row['Gateway'] for row in coordinator['NetworkSettings']['Networks'].values() if row.get('Gateway')}
if len(gateways)!=1:raise ValueError('Review ambiguous upload proxy peer')
peer=gateways.pop();peers=[peer,'::ffff:'+peer]
config=pathlib.Path('/opt/agent-os/deploy/nginx/nginx.host-network.conf');before=config.read_bytes();digest=hashlib.sha256(before).hexdigest()
with tempfile.TemporaryDirectory(prefix='adoption-upload-proxy-') as directory:
 candidate=pathlib.Path(directory)/config.name;candidate.write_bytes(before)
 subprocess.run(['docker','run','--rm','--network','none','--user','0:0','--entrypoint','node','-v',directory+':/nginx','-v',str(bundle)+':/release:ro',coordinator['Image'],'/release/deploy/update-nginx.mjs'],check=True)
 subprocess.run(['docker','run','--rm','--network','host','--volumes-from','agent-os-nginx-1','-v',str(candidate)+':/etc/nginx/conf.d/default.conf:ro','--entrypoint','nginx',proxy['Image'],'-t'],check=True)
 if hashlib.sha256(config.read_bytes()).hexdigest()!=digest:raise ValueError('Proxy changed during candidate validation; retry against new config')
 backup=config.with_name(config.name+'.before-'+release)
 if backup.exists():raise ValueError('Upload proxy backup already exists')
 backup.write_bytes(before);backup.chmod(0o600);config.write_bytes(candidate.read_bytes())
 try:
  subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-t'],check=True)
  subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-s','reload'],check=True)
 except BaseException:
  config.write_bytes(before)
  raise
subprocess.run(['docker','run','--rm','--network','none','--user','1000:1000','--entrypoint','node','-v','/opt/flolah-digital-adoption/config:/config','-v',str(bundle)+':/release:ro',coordinator['Image'],'/release/deploy/configure-upload-limits.mjs',json.dumps(peers)],check=True)
print('Upload proxy validated and reloaded; budgets saved for the next coordinator start. No unrelated routes or services changed.')
