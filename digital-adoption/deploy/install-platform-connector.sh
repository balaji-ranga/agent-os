#!/bin/sh
# Deploy previously built, reviewed scoped images. Keeps all other services/config.
set -eu
release=${1:?candidate release required}
case "$release" in *[!a-zA-Z0-9_-]*) exit 2;; esac
bundle=/opt/flolah-digital-adoption/releases/$release/platform
test -f "$bundle/previous.json"
docker image inspect "agent-os-backend:adoption-$release" >/dev/null
docker image inspect "agent-os-frontend:adoption-$release" >/dev/null
python3 - "$bundle" "$release" <<'PY'
import sys,json,pathlib,subprocess,secrets
bundle=pathlib.Path(sys.argv[1]);release=sys.argv[2];previous=json.loads((bundle/'previous.json').read_text())
for kind in ['backend','frontend']:
 current=json.loads(subprocess.check_output(['docker','inspect','agent-os-'+kind+'-1']))[0]
 if current['Image']!=previous[kind+'Id']:raise ValueError('Running platform changed after candidate preparation; rebuild before deploying')
config_path=pathlib.Path('/opt/flolah-digital-adoption/config/service.json');config=json.loads(config_path.read_text());token=config.get('taskBridgeToken') or secrets.token_urlsafe(48)
config['taskBridgeToken']=token;config['taskPolicyUrl']='http://backend:3001/api/integrations/digital-adoption/effect';config_path.write_text(json.dumps(config));config_path.chmod(0o600)
override={'services':{'backend':{'image':'agent-os-backend:adoption-'+release,'environment':{'DIGITAL_ADOPTION_BRIDGE_URL':'http://adoption:4197/','DIGITAL_ADOPTION_BRIDGE_TOKEN':token}},'frontend':{'image':'agent-os-frontend:adoption-'+release}}}
(bundle/'runtime.override.yml').write_text(json.dumps(override));(bundle/'runtime.override.yml').chmod(0o600)
files=list(dict.fromkeys((previous['backendCompose']+','+previous['frontendCompose']).split(',')))
(bundle/'compose-files.txt').write_text(','.join(files+[str(bundle/'runtime.override.yml')]))
# Preserve exact frontend source lineage for subsequent additive releases.
target=pathlib.Path('/opt/agent-os/releases')/('copilot-connector-'+release)/'context'
if not target.exists():
 import shutil
 shutil.copytree(bundle/'context',target)
PY
configs=$(cat "$bundle/compose-files.txt")
cd /opt/agent-os/deploy
COMPOSE_FILE="$configs" COMPOSE_PATH_SEPARATOR=, docker compose -p agent-os up -d --no-deps --no-build backend frontend
docker exec agent-os-nginx-1 nginx -t
docker exec agent-os-nginx-1 nginx -s reload
echo 'Scoped Copilot connector/editor deployed. OpenClaw and unrelated services were not restarted.'
