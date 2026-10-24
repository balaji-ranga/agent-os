"""Align only the internal adoption model proxy with bounded configurable input."""
import pathlib,re,subprocess,hashlib,datetime,json,os
path=pathlib.Path('/opt/agent-os/deploy/nginx/nginx.host-network.conf')
before=path.read_bytes();text=before.decode()
blocks=re.findall(r'location = /internal/digital-adoption-model\s*\{[^}]+\}',text)
if len(blocks)!=1:raise ValueError('Expected one internal model location')
old=blocks[0]
if not re.search(r'client_max_body_size\s+(32k|132096);',old):raise ValueError('Unexpected internal model ceiling')
new=re.sub(r'client_max_body_size\s+(32k|132096);','client_max_body_size 132096;',old)
next_bytes=text.replace(old,new).encode()
if before==next_bytes:
 print('Internal model ceiling already aligned');raise SystemExit(0)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup=path.with_name(path.name+'.before-model-context-'+stamp)
backup.write_bytes(before);os.chmod(backup,0o600)
if path.read_bytes()!=before:raise ValueError('Proxy changed concurrently')
try:
 path.write_bytes(next_bytes)
 subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-t'],check=True)
 subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-s','reload'],check=True)
except BaseException:
 if path.read_bytes()==next_bytes:
  path.write_bytes(before)
  subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-t'],check=True)
  subprocess.run(['docker','exec','agent-os-nginx-1','nginx','-s','reload'],check=True)
 raise
print(json.dumps({'at':stamp,'scope':'internal digital-adoption-model location only','edgeMaxBytes':132096,'beforeSha256':hashlib.sha256(before).hexdigest(),'afterSha256':hashlib.sha256(next_bytes).hexdigest(),'backupRetained':True,'syntaxValidated':True,'reloaded':True}))
