"""VPS candidate preparation; preserves deployed source and never restarts services."""
import pathlib,sys,json,subprocess,shutil,re
bundle=pathlib.Path(sys.argv[1]).resolve(); manifest=json.loads((bundle/'manifest.json').read_text()); release=manifest['release']
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',release):raise ValueError('Invalid release')
def inspect(name):return json.loads(subprocess.check_output(['docker','inspect',name]))[0]
backend,frontend=inspect('agent-os-backend-1'),inspect('agent-os-frontend-1')
revision=frontend['Config']['Labels'].get('org.flolah.copilot.revision','')
if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',revision):raise ValueError('Exact running frontend source revision unavailable')
source=pathlib.Path('/opt/agent-os/releases')/('copilot-'+revision)/'context/frontend'
# A later checker overlay has its own complete, immutable frontend context.
# Prefer it when labelled; using the older copilot context would revert its UI.
checker_revision=frontend['Config']['Labels'].get('org.flolah.checker.revision','')
if checker_revision:
 if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}',checker_revision):raise ValueError('Invalid checker source revision')
 source=pathlib.Path('/opt/flolah-digital-adoption/releases')/checker_revision/'frontend'
if not source.is_dir():raise ValueError('Running frontend source context missing')
context=bundle/'context'
if context.exists():raise ValueError('Candidate context already exists; use a new release')
shutil.copytree(source,context/'frontend',ignore=shutil.ignore_patterns('node_modules','dist','.env*','.git'))
current=bundle/'current';current.mkdir()
for name in manifest['paths']:
 code=re.fullmatch(r'(backend|frontend)/src/[A-Za-z0-9_./-]+\.(js|jsx)',name)
 documentation=name in ['knowledgebase/platform-help/64-digital-adoption-websites.md','knowledgebase/platform-help/65-copilot-workflow-connectors.md','docs-site/docs/systems/digital-adoption.md','docs-site/docs/systems/copilot-workflows.md']
 if not (code or documentation) or '..' in pathlib.PurePosixPath(name).parts:raise ValueError('Invalid scoped patch path')
 incoming=bundle/'incoming'/name;base=bundle/'base'/name;live=current/name;live.parent.mkdir(parents=True,exist_ok=True)
 if name.startswith('backend/') or documentation:
  result=subprocess.run(['docker','exec','agent-os-backend-1','cat','/opt/agent-os/'+name],capture_output=True)
  exists=result.returncode==0
  if exists:live.write_bytes(result.stdout.replace(b'\r\n',b'\n'))
 else:
  deployed=source/pathlib.PurePosixPath(name).relative_to('frontend');exists=deployed.is_file()
  if exists:live.write_bytes(deployed.read_bytes().replace(b'\r\n',b'\n'))
 output=context/name;output.parent.mkdir(parents=True,exist_ok=True)
 if base.exists():
  if not exists:raise ValueError('Deployed source disappeared: '+name)
  merged=subprocess.run(['git','merge-file','-p',str(live),str(base),str(incoming)],capture_output=True)
  if merged.returncode:raise ValueError('Review source merge conflict before deployment: '+name)
  output.write_bytes(merged.stdout)
 elif exists and live.read_bytes()!=incoming.read_bytes():raise ValueError('New module already has independent deployed changes: '+name)
 else:shutil.copyfile(incoming,output)
backend_image=backend['Config']['Image'];frontend_image=frontend['Config']['Image']
if any(not re.fullmatch(r'[A-Za-z0-9_./:@-]+',value) for value in [backend_image,frontend_image]):raise ValueError('Invalid image reference')
help_copy=''.join(f'COPY context/{name} /opt/agent-os/{name}\n' for name in manifest['paths'] if not name.startswith(('backend/','frontend/')))
(bundle/'Dockerfile.backend').write_text(f'FROM {backend_image}\nWORKDIR /opt/agent-os/backend\nCOPY context/backend/src/ ./src/\n'+help_copy)
(bundle/'Dockerfile.frontend').write_text(f'FROM node:22-bookworm-slim AS frontend-build\nWORKDIR /app\nCOPY context/frontend/package*.json ./\nRUN npm ci\nCOPY context/frontend/ ./\nRUN node scripts/generate-copilot-screen-inventory.mjs && npm run build\nFROM {frontend_image}\nCOPY --from=frontend-build /app/dist /usr/share/nginx/html\nLABEL org.flolah.copilot.revision="connector-{release}" org.flolah.checker.revision="" org.flolah.copilot.parent-checker-revision="{checker_revision}"\n')
(bundle/'previous.json').write_text(json.dumps({'backendImage':backend_image,'frontendImage':frontend_image,'backendId':backend['Image'],'frontendId':frontend['Image'],'backendCompose':backend['Config']['Labels']['com.docker.compose.project.config_files'],'frontendCompose':frontend['Config']['Labels']['com.docker.compose.project.config_files']}))
print('Scoped backend modules merged; exact deployed frontend source preserved. Candidate only; services unchanged.')
