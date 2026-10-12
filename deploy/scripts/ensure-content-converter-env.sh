#!/usr/bin/env bash
set -euo pipefail
env_file="${1:-/opt/agent-os/deploy/.env}"
python3 - "$env_file" <<'PY'
import os,re,secrets,sys
from pathlib import Path
path=Path(sys.argv[1])
if not path.is_file():
    raise SystemExit('Existing deployment environment file required; copy .env.example first.')
text=path.read_text()
match=re.search(r'^CONTENT_CONVERTER_TOKEN=(.*)$',text,re.M)
if match and match[1].strip().strip('"\''):
    if len(match[1].strip().strip('"\''))<32:
        raise SystemExit('Configured converter token is too short; set a strong token explicitly.')
else:
    line='CONTENT_CONVERTER_TOKEN='+secrets.token_hex(32)
    text=re.sub(r'^CONTENT_CONVERTER_TOKEN=.*$',line,text,flags=re.M) if match else text.rstrip()+'\n'+line+'\n'
    path.write_text(text)
os.chmod(path,0o600)
print('CONTENT_CONVERTER_SECRET_READY')
PY
