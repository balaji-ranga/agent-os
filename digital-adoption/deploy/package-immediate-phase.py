"""Build a credential-free scoped coordinator and platform source archive."""
import argparse, io, json, pathlib, re, subprocess, tarfile
p=argparse.ArgumentParser(description=__doc__);p.add_argument('release');p.add_argument('--base-ref',required=True);a=p.parse_args()
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',a.release):p.error('Invalid release')
root=pathlib.Path(__file__).resolve().parents[2];service=root/'digital-adoption'
base=subprocess.check_output(['git','-C',str(root),'rev-parse','--verify','--end-of-options',a.base_ref+'^{commit}'],text=True).strip()
paths=['backend/src/services/digital-adoption-connector-core.js','frontend/src/components/workflow/CopilotConnectorFields.jsx','knowledgebase/platform-help/64-digital-adoption-websites.md','knowledgebase/platform-help/65-copilot-workflow-connectors.md','docs-site/docs/systems/digital-adoption.md','docs-site/docs/systems/copilot-workflows.md']
out=service/'.local'/('immediate-'+a.release+'.tar.gz')
with out.open('xb') as stream,tarfile.open(fileobj=stream,mode='w:gz') as archive:
 def add(name,data):
  data=data.replace(b'\r\n',b'\n');info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;archive.addfile(info,io.BytesIO(data))
 for folder in ['src','web','integrations','deploy']:
  for file in sorted((service/folder).rglob('*')):
   if file.is_file() and file.suffix in ['.mjs','.py','.sh','.html','.css','.md','.txt','.yml','.json','.dockerignore','.conf','.example'] or file.is_file() and 'Dockerfile' in file.name:
    if file.is_symlink() or any(x in file.parts for x in ['node_modules','.local','__pycache__']):continue
    if file.name.startswith('.env') or file.suffix in ['.pem','.key']:raise ValueError('Secret file in source selection')
    add(file.relative_to(service).as_posix(),file.read_bytes())
 for file in sorted((service/'test').glob('*.test.mjs')):add(file.relative_to(service).as_posix(),file.read_bytes())
 for name in ['fixture.html','vps-demo.html','conditional-form.html','recovery-browser.mjs','complex-performance.mjs','partial-progress-live.mjs','autonomy-browser.mjs','acceptance-catalog.mjs','evidence-ledger.mjs']:add('test/'+name,(service/'test'/name).read_bytes())
 for file in sorted((service/'test/fixtures').rglob('*')):
  if file.is_file() and not file.is_symlink():add(file.relative_to(service).as_posix(),file.read_bytes())
 for name in ['package.json','package-lock.json','.dockerignore']:add(name,(service/name).read_bytes())
 for name in paths:
  add('platform/incoming/'+name,(root/name).read_bytes())
  before=subprocess.run(['git','-C',str(root),'show',base+':'+name],capture_output=True)
  if before.returncode==0:add('platform/base/'+name,before.stdout)
 add('platform/manifest.json',json.dumps({'release':a.release,'baseCommit':base,'paths':paths}).encode())
 for name in ['publish-copilot-help.mjs','verify-copilot-help.mjs']:
  add('platform/verification/'+name,(root/'backend/scripts'/name).read_bytes())
print(out)
