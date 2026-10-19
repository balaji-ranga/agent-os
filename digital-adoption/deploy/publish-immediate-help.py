"""Publish/verify shipped platform help without assuming helpers exist in the image."""
import pathlib,re,subprocess,sys
release=sys.argv[1]
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',release):raise ValueError('Invalid release')
bundle=pathlib.Path('/opt/flolah-digital-adoption/releases')/release
for action in ['publish','verify']:
 source=(bundle/'platform/verification'/f'{action}-copilot-help.mjs').read_text()
 source=source.replace("'../src/","'/opt/agent-os/backend/src/")
 with (bundle/('help-publication.log' if action=='publish' else 'help-verification.log')).open('w') as log:
  subprocess.run(['docker','exec','-i','-w','/opt/agent-os/backend','agent-os-backend-1','node','--input-type=module'],input=source,text=True,stdout=log,stderr=subprocess.STDOUT,check=True)
print('Shipped platform help published and exact indexed hashes/retrieval verified.')
