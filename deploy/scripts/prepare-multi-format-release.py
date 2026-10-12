"""Prepare a feature-only image overlay, preserving concurrent VPS changes.

No live source, environment or service is changed by this preparation command.
Run on the VPS after unpacking package-multi-format-release.mjs output.
"""
import hashlib,json,pathlib,shutil,subprocess,sys,tempfile
release=pathlib.Path(sys.argv[1]).resolve()
root=pathlib.Path('/opt/agent-os')
manifest=json.loads((release/'manifest.json').read_text())
stage=pathlib.Path(tempfile.mkdtemp(prefix='multiformat-build-',dir='/tmp'))
def run(*args,**kw): return subprocess.run(args,check=True,**kw)
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else None
checks={}
for p in manifest['modified']+manifest['added']:
    relative=pathlib.PurePosixPath(p)
    if relative.is_absolute() or '..' in relative.parts: raise RuntimeError('Unsafe manifest path')
    source=root/p;dest=stage/p;dest.parent.mkdir(parents=True,exist_ok=True)
    checks[p]=digest(source)
    if source.exists(): shutil.copy2(source,dest)
# Capture exactly the running backend's source rather than implicitly deploying host-only edits.
for part in ['src','scripts','package.json']:
    run('docker','cp',f'agent-os-backend-1:/opt/agent-os/backend/{part}',str(stage/'backend'))
def merge_text(p,current):
    paths=[]
    for index,source in enumerate([release/'files'/p,release/'base'/p,current]):
        temp=stage/f'merge-{index}.txt';temp.write_bytes(source.read_bytes().replace(b'\r\n',b'\n'));paths.append(str(temp))
    result=subprocess.run(['git','merge-file','-p',*paths],capture_output=True)
    # Both branches append independent example configuration. Preserve the VPS example and
    # append only the new, credential-free converter documentation.
    if result.returncode and p=='backend/.env.example':
        addition=(release/'files'/p).read_text().split('# Private multi-format',1)
        if len(addition)==2:return current.read_bytes().rstrip()+b'\n\n# Private multi-format'+addition[1].encode()
    if result.returncode and p=='deploy/scripts/sync-to-vps.ps1':
        text=current.read_text()
        additions=[
          ('  "$Repo\\deploy\\docker-compose.docker-tools.yml" `','  "$Repo\\deploy\\docker-compose.content-converter.yml" `'),
          ('  "$Repo\\deploy\\README.md" `','  "$Repo\\deploy\\MULTI_FORMAT_CONTENT_TOOL.md" `'),
          ('  "$Repo\\deploy\\scripts\\vps-deploy-latest.sh" `','  "$Repo\\deploy\\scripts\\ensure-content-converter-env.sh" `'),
          ('    "$Repo\\backend\\scripts\\test-media-url.js" `','    "$Repo\\backend\\scripts\\test-multi-format-content.mjs" `'),
          ('  scp @ssh -r "$Repo\\scripts" "root@${HostIp}:$RemoteRoot/"','  scp @ssh -r "$Repo\\tools\\content-converter" "root@${HostIp}:$RemoteRoot/tools/"'),
        ]
        for anchor,addition in additions:
            if addition in text:continue
            if text.count(anchor)!=1:raise RuntimeError('Unambiguous sync anchor missing')
            text=text.replace(anchor,anchor+'\n'+addition)
        return text.encode()
    if result.returncode: raise RuntimeError('Manual merge required: '+p)
    return result.stdout
for p in manifest['modified']:
    result=subprocess.run(['git','apply','--ignore-space-change','--include='+p,str(release/'tracked.patch')],cwd=stage,capture_output=True)
    if result.returncode:
        current=stage/p
        current.write_bytes(merge_text(p,current))
for p in manifest['added']:
    target=stage/p;source=release/'files'/p
    if target.exists() and target.read_bytes()!=source.read_bytes(): raise RuntimeError('New-file collision: '+p)
    shutil.copy2(source,target)
# Save independent host-source merges for eventual source parity; runtime backend may be newer/older.
host=stage/'host-source'
for p in manifest['modified']+manifest['added']:
    dest=host/p;dest.parent.mkdir(parents=True,exist_ok=True)
    if p in manifest['added'] or not (root/p).exists(): shutil.copy2(stage/p,dest);continue
    dest.write_bytes(merge_text(p,root/p))
(stage/'source-checks.json').write_text(json.dumps(checks,indent=2))
image=subprocess.check_output(['docker','inspect','-f','{{.Image}}','agent-os-backend-1'],text=True).strip()
(stage/'previous-image.txt').write_text(image)
base_tag='agent-os-backend:multiformat-base-'+image.split(':')[-1][:12]
run('docker','tag',image,base_tag)
(stage/'backend-overlay.Dockerfile').write_text(f'''FROM {base_tag}
COPY backend/src /opt/agent-os/backend/src
COPY backend/scripts /opt/agent-os/backend/scripts
COPY backend/package.json /opt/agent-os/backend/package.json
COPY openclaw-workspace-templates /opt/agent-os/openclaw-workspace-templates
COPY openclaw-extensions /opt/agent-os/openclaw-extensions
COPY scripts /opt/agent-os/scripts
COPY deploy /opt/agent-os/deploy
''')
print(json.dumps({'stage':str(stage),'previous_backend_image':image,'feature_files':len(checks)}))
