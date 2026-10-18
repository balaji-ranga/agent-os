"""Package only the additive Flolah connector/editor patch, with merge bases."""
import argparse, pathlib, subprocess, tarfile, io, json, re
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('release');parser.add_argument('--base-ref',required=True,help='Commit before the connector changes; do not use an already updated HEAD');args=parser.parse_args()
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',args.release): parser.error('Invalid release')
repo=pathlib.Path(__file__).resolve().parents[2]
base_commit=subprocess.check_output(['git','-C',str(repo),'rev-parse','--verify','--end-of-options',args.base_ref+'^{commit}'],text=True).strip()
paths=['backend/src/index.js','backend/src/routes/digital-adoption.js','backend/src/routes/openconnector.js','backend/src/routes/tools.js','backend/src/services/action-policy.js','backend/src/services/agent-workflow-runner.js','backend/src/services/agent-workflow-desktop-runtime.js','backend/src/services/agent-workflow-run-manager.js','backend/src/services/connector-action-grants.js','backend/src/services/openconnector.js','backend/src/services/org-permissions.js','backend/src/services/digital-adoption-connector-core.js','backend/src/services/digital-adoption-connector.js','frontend/src/api.js','frontend/src/pages/AgentWorkflowEditor.jsx','frontend/src/components/workflow/CopilotConnectorFields.jsx']
paths += ['backend/src/routes/admin.js','backend/src/routes/admin-copilot-quality.js','backend/src/services/copilot-quality-settings.js','frontend/src/pages/Admin.jsx','frontend/src/pages/AdminModels.jsx','frontend/src/components/CopilotQualityControls.jsx']
paths += ['frontend/src/App.jsx','frontend/src/components/AppNavMenu.jsx','frontend/src/pages/AdminDigitalAdoption.jsx']
out=repo/'digital-adoption/.local'/f'platform-connector-{args.release}.tar.gz'
with out.open('xb') as destination:
 with tarfile.open(fileobj=destination,mode='w:gz') as archive:
  def add(name,data):
   info=tarfile.TarInfo(name);info.size=len(data);info.mode=0o644;archive.addfile(info,io.BytesIO(data))
  for name in paths:
   path=repo/name
   if path.is_symlink() or not path.resolve().is_relative_to(repo): parser.error('Unsafe source path')
   add('incoming/'+name,path.read_bytes().replace(b'\r\n',b'\n'))
   base=subprocess.run(['git','-C',str(repo),'show',base_commit+':'+name],capture_output=True)
   if base.returncode==0:add('base/'+name,base.stdout.replace(b'\r\n',b'\n'))
  add('manifest.json',json.dumps({'release':args.release,'baseCommit':base_commit,'paths':paths}).encode())
print(f'Packaged {len(paths)} scoped connector source files: {out}')
