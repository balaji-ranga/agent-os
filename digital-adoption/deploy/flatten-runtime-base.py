"""Compact a captured image without running it or including runtime mounts."""
import json, pathlib, subprocess, sys, tempfile
source, target = sys.argv[1:]
metadata=json.loads(subprocess.check_output(['docker','image','inspect',source]))[0]
config=metadata['Config']
if config.get('Healthcheck') or config.get('OnBuild'):
    raise ValueError('Image health/on-build metadata requires explicit preservation')
changes=[]
for key,instruction in [('Entrypoint','ENTRYPOINT'),('Cmd','CMD')]:
    if config.get(key) is not None: changes+=['--change',instruction+' '+json.dumps(config[key])]
for key,instruction in [('WorkingDir','WORKDIR'),('User','USER'),('StopSignal','STOPSIGNAL')]:
    if config.get(key): changes+=['--change',instruction+' '+config[key]]
for value in config.get('Env') or []:
    key,content=value.split('=',1);changes+=['--change','ENV '+key+'='+json.dumps(content)]
for key,value in (config.get('Labels') or {}).items():
    changes+=['--change','LABEL '+json.dumps(key)+'='+json.dumps(value)]
for port in config.get('ExposedPorts') or {}: changes+=['--change','EXPOSE '+port]
if config.get('Volumes'):changes+=['--change','VOLUME '+json.dumps(list(config['Volumes']))]
container=subprocess.check_output(['docker','create',source],text=True).strip()
try:
    with tempfile.TemporaryDirectory(prefix='adoption-image-base-') as directory:
        archive=pathlib.Path(directory)/'rootfs.tar'
        subprocess.run(['docker','export','-o',str(archive),container],check=True)
        subprocess.run(['docker','import',*changes,str(archive),target],check=True,stdout=subprocess.DEVNULL)
finally:
    subprocess.run(['docker','rm',container],check=True,stdout=subprocess.DEVNULL)
compacted=json.loads(subprocess.check_output(['docker','image','inspect',target]))[0]
for key in ['Entrypoint','Cmd','WorkingDir','User','StopSignal','Env','Labels','ExposedPorts','Volumes']:
    assert (compacted['Config'].get(key) or None)==(config.get(key) or None),key+' metadata changed'
assert compacted['Architecture']==metadata['Architecture'] and compacted['Os']==metadata['Os']
print('Captured image compacted; image metadata preserved; no runtime mounts exported.')
