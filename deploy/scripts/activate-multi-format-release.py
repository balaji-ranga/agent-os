"""Scoped cutover after image/harness verification; preserve other service images/overlays.

Usage: python3 activate-multi-format-release.py STAGE --activate
Backups contain private operator data; never publish their contents.
"""
import hashlib,json,pathlib,shutil,subprocess,sys,tempfile,time,urllib.request
assert '--activate' in sys.argv,'Explicit --activate required'
stage=pathlib.Path(sys.argv[1]).resolve();root=pathlib.Path('/opt/agent-os')
assert str(stage).startswith('/tmp/multiformat-build-') and stage.is_dir()
def run(*args,**kw):return subprocess.run(args,check=True,**kw)
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
checks=json.loads((stage/'source-checks.json').read_text())
for p,expected in checks.items():
    if digest(root/p)!=expected:raise RuntimeError('Concurrent source change; reprepare '+p)
backend=inspect('agent-os-backend-1')
assert backend['Image']==(stage/'previous-image.txt').read_text(),'Concurrent deployment; stop'
files=backend['Config']['Labels']['com.docker.compose.project.config_files'].split(',')
assert all(pathlib.Path(p).is_file() for p in files)
assert any('vps-client-ip' in p for p in files) and any('content-antivirus' in p for p in files)
backup=pathlib.Path(tempfile.mkdtemp(prefix='multiformat-rollback-',dir='/opt/agent-os/deploy'))
backup.chmod(0o700)
(backup/'runtime.json').write_text(json.dumps({'backend_image':backend['Image'],'compose_files':files},indent=2))
gateway=inspect('agent-os-openclaw-1')
(backup/'gateway-image.txt').write_text(gateway['Image'])
# Merge exactly this feature into the actual installed plugin, not an older repository copy.
plugin=stage/'installed-plugin';plugin.mkdir()
run('docker','cp','agent-os-openclaw-1:/root/.openclaw/extensions/agent-os-content-tools/.',str(plugin))
plugin_before=backup/'installed-plugin';shutil.copytree(plugin,plugin_before)
release=pathlib.Path('/tmp/multi-format-release')
for name in ['index.js','index.ts']:
    p='openclaw-extensions/agent-os-content-tools/'+name
    current=plugin/name
    if not current.exists():continue
    inputs=[]
    for i,source in enumerate([release/'files'/p,release/'base'/p,current]):
        tmp=stage/f'plugin-merge-{i}';tmp.write_bytes(source.read_bytes().replace(b'\r\n',b'\n'));inputs.append(str(tmp))
    merged=subprocess.run(['git','merge-file','-p',*inputs],capture_output=True)
    if merged.returncode:raise RuntimeError('Installed plugin needs manual merge: '+name)
    current.write_bytes(merged.stdout)
shutil.copy2(stage/'openclaw-extensions/agent-os-content-tools/multi-format-schema.js',plugin/'multi-format-schema.js')
# Startup refreshes plugins from the image: a docker cp alone is not persistent.
manifest=plugin/'openclaw.plugin.json';description=json.loads(manifest.read_text())
names=description.setdefault('contracts',{}).setdefault('tools',[])
if 'multi-format-content-tool' not in names:names.insert(0,'multi-format-content-tool')
description.setdefault('toolMetadata',{})['multi-format-content-tool']={'optional':True}
manifest.write_text(json.dumps(description,indent=2)+'\n')
for source,target in [('scripts/lib/content-tools-allow.js','gateway-script-allow.js'),('backend/src/lib/content-tools-allow.js','gateway-backend-allow.js')]:
    p=stage/target;run('docker','cp','agent-os-openclaw-1:/opt/agent-os/'+source,str(p))
    text=p.read_text()
    for marker in ['export const REQUIRED_GLOBAL_CONTENT_TOOLS = [','export const COO_DEFAULT_CONTENT_TOOLS = [','export const COO_CONTENT_TOOLS_ALLOW = [']:
        if marker in text and "'multi-format-content-tool'" not in text.split(marker,1)[1].split('];',1)[0]:text=text.replace(marker,marker+"\n  'multi-format-content-tool',",1)
    p.write_text(text)
current=stage/'gateway-original-entrypoint.sh';run('docker','cp','agent-os-openclaw-1:/entrypoint.sh',str(current))
inputs=[]
for i,source in enumerate([release/'files/deploy/docker/openclaw-entrypoint.sh',release/'base/deploy/docker/openclaw-entrypoint.sh',current]):
    p=stage/f'gateway-merge-{i}';p.write_bytes(source.read_bytes().replace(b'\r\n',b'\n'));inputs.append(str(p))
merged=subprocess.run(['git','merge-file','-p',*inputs],capture_output=True)
if merged.returncode:raise RuntimeError('Gateway entrypoint requires manual merge')
(stage/'gateway-entrypoint.sh').write_bytes(merged.stdout)
run('bash','-n',str(stage/'gateway-entrypoint.sh'))
gateway_base='agent-os-openclaw:multiformat-base-'+gateway['Image'].split(':')[-1][:12]
run('docker','tag',gateway['Image'],gateway_base)
(stage/'gateway-overlay.Dockerfile').write_text(f'''FROM {gateway_base}
COPY installed-plugin/index.js installed-plugin/multi-format-schema.js installed-plugin/openclaw.plugin.json /opt/agent-os/openclaw-extensions/agent-os-content-tools/
COPY gateway-script-allow.js /opt/agent-os/scripts/lib/content-tools-allow.js
COPY gateway-backend-allow.js /opt/agent-os/backend/src/lib/content-tools-allow.js
COPY gateway-entrypoint.sh /entrypoint.sh
COPY gateway-entrypoint.sh /opt/agent-os/deploy/docker/openclaw-entrypoint.sh
COPY deploy/scripts/openclaw-agent-db-preflight.mjs deploy/scripts/test-openclaw-agent-db-preflight.mjs deploy/scripts/test-openclaw-model-reload.py /opt/agent-os/deploy/scripts/
RUN chmod 755 /entrypoint.sh
''')
run('docker','build','-f',str(stage/'gateway-overlay.Dockerfile'),'-t','agent-os-openclaw:multiformat-20261012',str(stage))
run('docker','run','--rm','--network','none','--entrypoint','node','agent-os-openclaw:multiformat-20261012','/opt/agent-os/deploy/scripts/test-openclaw-agent-db-preflight.mjs','--native')
run('docker','run','--rm','--network','none','--entrypoint','python3','agent-os-openclaw:multiformat-20261012','/opt/agent-os/deploy/scripts/test-openclaw-model-reload.py')
# All checks precede live writes. Backup each exact source path; no directory deletion.
for p in checks:
    dest=backup/'source'/p;dest.parent.mkdir(parents=True,exist_ok=True)
    if (root/p).exists():shutil.copy2(root/p,dest)
for p in checks:
    source=stage/'host-source'/p
    # Test-only revisions after preparation have no parallel production behavior.
    if p=='backend/scripts/test-multi-format-content.mjs':source=stage/p
    if p.startswith('tools/content-converter/'):source=stage/p
    target=root/p;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
for name in ['index.js','index.ts','multi-format-schema.js']:
    if (plugin/name).exists():run('docker','cp',str(plugin/name),'agent-os-openclaw-1:/root/.openclaw/extensions/agent-os-content-tools/'+name)
env=root/'deploy/.env';shutil.copy2(env,backup/'deployment.env');(backup/'deployment.env').chmod(0o600)
run('bash',str(root/'deploy/scripts/ensure-content-converter-env.sh'),str(env))
overlay=root/'deploy/docker-compose.multi-format-release.yml'
if overlay.exists():shutil.copy2(overlay,backup/'previous-image-overlay.yml')
overlay.write_text('services:\n  backend:\n    image: agent-os-backend:multiformat-20261012\n  content-converter:\n    image: agent-os-content-converter:multiformat-20261012\n  openclaw:\n    image: agent-os-openclaw:multiformat-20261012\n')
converter=str(root/'deploy/docker-compose.content-converter.yml')
files=list(dict.fromkeys(files+[converter,str(overlay)]))
command=['docker','compose','--project-name','agent-os','--env-file',str(env)]
for p in files:command+=['-f',p]
# Validate merged configuration without logging environment values.
configuration=json.loads(subprocess.check_output(command+['config','--format','json']))
assert 'content_scan' in configuration['services']['backend']['networks']
assert 'content_conversion' in configuration['services']['backend']['networks']
assert configuration['networks']['content_conversion'].get('internal') is True
assert not configuration['services']['content-converter'].get('ports')
run(*command,'up','-d','--no-deps','--no-build','content-converter','backend')
for _ in range(30):
    try:
        if urllib.request.urlopen('http://127.0.0.1:3001/health',timeout=2).status==200:break
    except Exception:pass
    time.sleep(1)
else:raise RuntimeError('Backend health failed; retained rollback at '+str(backup))
# Descriptor registration is startup-time in OpenClaw; reload once to expose the new tool.
run(*command,'up','-d','--no-deps','--no-build','openclaw')
print(json.dumps({'activated':True,'rollback':str(backup),'backend_image':inspect('agent-os-backend-1')['Image'],'converter_image':inspect('agent-os-content-converter-1')['Image'],'preserved_overlays':len(files)}))
