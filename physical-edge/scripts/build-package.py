from pathlib import Path
import zipfile,hashlib,json,subprocess,shutil
root=Path(__file__).resolve().parents[2]
out=root/'physical-edge/dist';out.mkdir(exist_ok=True)
version=json.loads((root/'physical-edge/package.json').read_text())['version']
name=f'flolah-physical-edge-{version}.zip'
entries={}
for folder in ['physical-edge/src','physical-edge/public']:
 for p in (root/folder).rglob('*'):
  if p.is_file():entries[str(p.relative_to(root)).replace('\\','/')]=p.read_bytes()
for f in ['physical-edge/package.json','physical-edge/package-lock.json','physical-edge/run.ps1','physical-edge/run.sh','physical-edge/README.md','THIRD_PARTY_NOTICES.md']:
 entries[f]=(root/f).read_bytes()
for f in ['contracts.js','output-contracts.js','control-plane.js','socket-server.js','evidence-store.js','managed-config.js','managed-control.js','pagination.js']:
 entries['backend/src/services/physical/'+f]=(root/'backend/src/services/physical'/f).read_bytes()
for f in ['backend/src/routes/physical-api.js','backend/src/public/physical.html']:
 entries[f]=(root/f).read_bytes()
entries['physical-edge/config/gateway.example.json']=(root/'physical-edge/config/gateway.example.json').read_bytes()
backend=json.loads((root/'backend/package.json').read_text())
entries['backend/package.json']=json.dumps({'private':True,'type':'module','dependencies':{k:backend['dependencies'][k] for k in ['express','ws']}}).encode()
# Generate a portable lab-only dependency lock, with no production DB/AI packages.
stage=out/'.lock';stage.mkdir(exist_ok=True);(stage/'package.json').write_bytes(entries['backend/package.json'])
subprocess.run(['npm.cmd' if __import__('os').name=='nt' else 'npm','install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],cwd=stage,check=True)
entries['backend/package-lock.json']=(stage/'package-lock.json').read_bytes()
entries['check-node.mjs']=b"if(Number(process.versions.node.split('.')[0])<22)throw Error('Install Node.js 22 or later');"
entries['START-HERE.txt']=f"Flolah Edge pilot {version}\nRequires Node.js 22+. Extract the entire archive.\nWindows: cd physical-edge; .\\run.ps1\nLinux: cd physical-edge; sh run.sh\nThese start the local simulator lab, not production.\nFor actual Flolah: enroll hub in Connectors > Physical AI, save protected config, then run.ps1 -Mode gateway -Config <absolute path> or sh run.sh gateway <absolute path>.\nRead physical-edge/README.md. No HA server, MQTT production broker or Node runtime is silently installed.\n".encode()
with zipfile.ZipFile(out/name,'w',zipfile.ZIP_DEFLATED) as z:
 for path,data in sorted(entries.items()):z.writestr(path,data)
items=[]
for path,label,platform in [(out/name,'Windows / Linux edge suite + simulator','desktop'),(out/'flolah-physical-edge-android.apk','Android foreground edge pilot','android')]:
 if path.exists() and (platform!='android' or '--include-android' in __import__('sys').argv):items.append({'file':path.name,'label':label,'platform':platform,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(out/'manifest.json').write_text(json.dumps({'version':version,'packages':items},indent=2))
print(json.dumps({'version':version,'packages':items}))
