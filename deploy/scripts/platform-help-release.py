"""Package, prepare and activate a documentation-only platform release.

The captured backend is the immutable base. Three-way merges preserve concurrent
help edits; activation refuses changed source/container state. No credentials,
model settings, frontend image or Digital Adoption runtime are modified.
"""
import argparse, hashlib, io, json, pathlib, re, shutil, subprocess, tarfile, time

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('mode',choices=['package','prepare','activate'])
parser.add_argument('target',help='Unique revision for package; extracted release directory otherwise')
parser.add_argument('--base-ref',default='HEAD')
parser.add_argument('--root',type=pathlib.Path,default=pathlib.Path('/opt/agent-os'))
args=parser.parse_args()
support=['deploy/docker/backend.platform-help.Dockerfile','backend/scripts/check-platform-help-corpus.mjs','backend/scripts/verify-copilot-help.mjs','backend/scripts/scan-public-docs-sensitive.js','backend/src/services/company-blueprints/secret-sanitize.js']
def run(*cmd,**kw):return subprocess.run(cmd,check=True,**kw)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
def allowed(path):return '..' not in pathlib.PurePosixPath(path).parts and (path.startswith('knowledgebase/platform-help/') and path.endswith('.md') or path.startswith('docs-site/docs/') and path.endswith(('.md','.mdx')) or path in ['docs-site/sidebars.js','backend/src/services/ceo-default-master-data.js'])

if args.mode=='package':
 revision=args.target
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',revision):parser.error('Invalid revision')
 root=pathlib.Path(__file__).resolve().parents[2]
 base=subprocess.check_output(['git','-C',str(root),'rev-parse','--verify','--end-of-options',args.base_ref+'^{commit}'],text=True).strip()
 changed=subprocess.check_output(['git','-C',str(root),'diff','--name-only',base,'--','knowledgebase/platform-help','docs-site/docs','docs-site/sidebars.js','backend/src/services/ceo-default-master-data.js'],text=True).splitlines()
 untracked=subprocess.check_output(['git','-C',str(root),'ls-files','--others','--exclude-standard','--','knowledgebase/platform-help','docs-site/docs'],text=True).splitlines()
 # Include existing coaching/map guides so an older deployed corpus is merged,
 # rather than assuming an unchanged local file already shipped to the server.
 paths=sorted(set(changed+untracked+['knowledgebase/platform-help/'+name for name in ['56-okr-company-demo-seed-pack.md','57-event-productivity-pack.md','58-marketing-operations.md','59-company-email-channels.md','60-risk-classifications.md','62-copilot-coaching.md','63-copilot-platform-map.md']]))
 if not paths or not all(allowed(p) for p in paths):parser.error('Invalid help scope')
 output=root/'digital-adoption/.local'/f'platform-help-{revision}.tar.gz'
 with output.open('xb') as destination,tarfile.open(fileobj=destination,mode='w:gz') as archive:
  def add(name,data):
   info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;archive.addfile(info,io.BytesIO(data))
  for p in paths:
   path=root/p
   if not path.is_file() or path.is_symlink():parser.error('Unsafe or missing file '+p)
   add('incoming/'+p,path.read_bytes().replace(b'\r\n',b'\n'))
   old=subprocess.run(['git','-C',str(root),'show',base+':'+p],capture_output=True)
   if old.returncode==0:add('base/'+p,old.stdout.replace(b'\r\n',b'\n'))
  for p in support:add('support/'+p,(root/p).read_bytes().replace(b'\r\n',b'\n'))
  add('platform-help-release.py',pathlib.Path(__file__).read_bytes().replace(b'\r\n',b'\n'))
  add('manifest.json',json.dumps({'revision':revision,'baseCommit':base,'paths':paths}).encode())
 print(output);raise SystemExit

root=args.root.resolve();release=pathlib.Path(args.target).resolve()
if release.parent!=root/'releases':raise RuntimeError('Release must be under the configured deployment root')
manifest=json.loads((release/'manifest.json').read_text());revision=manifest['revision'];paths=manifest['paths'];context=release/'context'
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',revision) or not all(allowed(p) for p in paths):raise RuntimeError('Invalid manifest')
def inspect():return json.loads(subprocess.check_output(['docker','inspect','agent-os-backend-1']))[0]
def signature():
 d=inspect();return [d['Id'],d['Image'],d['State']['StartedAt']]
def copy_container(part,destination):
 destination.parent.mkdir(parents=True,exist_ok=True);run('docker','cp','agent-os-backend-1:/opt/agent-os/'+part,str(destination))
def recreate(image,state):
 override=release/'backend.override.yml';override.write_text('services:\n  backend:\n    image: '+image+'\n')
 cmd=['docker','compose','-p','agent-os']
 for f in state['compose'].split(','):cmd+=['-f',f]
 run(*cmd,'-f',str(override),'up','-d','--no-deps','--no-build','--force-recreate','backend',cwd=root/'deploy')
 for _ in range(60):
  if inspect()['State'].get('Health',{}).get('Status')=='healthy':return
  time.sleep(2)
 raise RuntimeError('Backend health deadline exceeded')

if args.mode=='prepare':
 if context.exists():raise RuntimeError('Release already prepared')
 state={'backend':signature(),'compose':inspect()['Config']['Labels']['com.docker.compose.project.config_files'],'source':{p:sha(root/p) for p in paths}}
 context.mkdir();copy_container('knowledgebase/platform-help',context/'knowledgebase/platform-help')
 copy_container('backend/src/services/ceo-default-master-data.js',context/'backend/src/services/ceo-default-master-data.js')
 shutil.copytree(root/'docs-site',context/'docs-site',ignore=shutil.ignore_patterns('node_modules','build','build-blog','.docusaurus','.env*'))
 for p in paths:
  dest=context/p;desired=(release/'incoming'/p).read_bytes();base=release/'base'/p
  if dest.exists():
   current=dest.read_bytes().replace(b'\r\n',b'\n')
   if not base.exists():
    if current!=desired:raise RuntimeError('New-file collision '+p)
   else:
    parts=[]
    for n,data in enumerate([current,base.read_bytes(),desired]):
     tmp=release/f'merge-{n}';tmp.write_bytes(data);parts.append(str(tmp))
    result=subprocess.run(['git','merge-file','-p',*parts],capture_output=True)
    if result.returncode:
     # A pure appendix cannot remove any deployed edits. Git can still mark
     # an EOF paragraph plus an adjacent appendix as a conflict; preserve the
     # complete deployed document and append exactly the new reviewed suffix.
     prefix=base.read_bytes().rstrip(b'\n')
     if not desired.startswith(prefix+b'\n'):raise RuntimeError('Concurrent help edit needs review: '+p)
     desired=current.rstrip(b'\n')+desired[len(prefix):]
    else:desired=result.stdout
  elif base.exists():raise RuntimeError('Expected deployed help source missing: '+p)
  dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(desired)
 for p in support:
  dest=context/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(release/'support'/p,dest)
 # The scanner is dependency-free apart from this shipped sanitizer module.
 (context/'backend/package.json').write_text('{"type":"module"}\n')
 run('docker','run','--rm','-v',str(context)+':/repo:ro','-w','/repo','--entrypoint','node',state['backend'][1],'backend/scripts/scan-public-docs-sensitive.js')
 run('docker','tag',state['backend'][1],'agent-os-backend:help-base-'+revision)
 run('docker','build','--build-arg','BASE_IMAGE=agent-os-backend:help-base-'+revision,'--build-arg','HELP_REVISION='+revision,'-f',str(context/'deploy/docker/backend.platform-help.Dockerfile'),'-t','agent-os-backend:help-'+revision,str(context))
 output=release/'public-docs';output.mkdir()
 run('docker','run','--rm','-e','CI=true','-v',str(context/'docs-site')+':/src:ro','-v',str(output)+':/out','--entrypoint','sh','node:22-bookworm-slim','-c','set -eu; cp -a /src /tmp/docs; cd /tmp/docs; npm ci --ignore-scripts; npm run build; cp -a build/. /out/')
 (release/'captured.json').write_text(json.dumps(state));(release/'prepared.ok').write_text('Prepared\n');print('HELP_PREPARED '+revision)
else:
 if not (release/'prepared.ok').exists() or (release/'activated.ok').exists():raise RuntimeError('Invalid activation state')
 state=json.loads((release/'captured.json').read_text())
 if signature()!=state['backend'] or any(sha(root/p)!=v for p,v in state['source'].items()):raise RuntimeError('Concurrent deployment or source change; prepare a fresh release')
 public=root/'deploy/static/flolah-home/docs';backup=release/'public-before'
 if public.exists():shutil.copytree(public,backup)
 for p in paths:
  if (root/p).exists():dest=release/'source-before'/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(root/p,dest)
 try:
  recreate('agent-os-backend:help-'+revision,state)
  # Update the bind-mounted directory in place. Removing/renaming its root
  # would leave an existing nginx mount attached to the old inode.
  public.mkdir(parents=True,exist_ok=True);shutil.copytree(release/'public-docs',public,dirs_exist_ok=True)
  for p in paths:
   dest=root/p;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(context/p,dest)
  run('docker','exec','agent-os-nginx-1','nginx','-t');run('docker','exec','agent-os-nginx-1','nginx','-s','reload')
  run('docker','exec','agent-os-backend-1','node','scripts/reupload-platform-help-docs.js')
  run('docker','exec','agent-os-backend-1','node','scripts/verify-copilot-help.mjs')
  (release/'activated.ok').write_text('Healthy and reindexed\n');print('HELP_DEPLOYED '+revision)
 except Exception:
  recreate(state['backend'][1],state)
  if backup.exists():
   for path in public.rglob('*'):
    if path.is_file() and not (backup/path.relative_to(public)).exists():path.unlink()
   shutil.copytree(backup,public,dirs_exist_ok=True)
  for p in paths:
   if (release/'source-before'/p).exists():shutil.copy2(release/'source-before'/p,root/p)
  subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-s','reload']);raise
