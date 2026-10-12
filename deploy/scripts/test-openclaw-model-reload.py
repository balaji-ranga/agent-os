"""Exercise the real entrypoint watcher with isolated fake endpoints, never production config."""
import json, os, pathlib, signal, subprocess, tempfile, time
root=pathlib.Path(tempfile.mkdtemp(prefix='flolah-model-reload-'));bin_dir=root/'bin';bin_dir.mkdir()
app=root/'app';scripts=app/'deploy/scripts';scripts.mkdir(parents=True);home=root/'home';home.mkdir()
trace=root/'trace';pid_file=root/'gateway.pid'
def executable(name,text):
    p=bin_dir/name;p.write_text(text);p.chmod(0o700)
executable('openclaw',"""#!/usr/bin/env python3
import os,pathlib,time
pathlib.Path(os.environ['QA_PID']).write_text(str(os.getpid()))
with open(os.environ['QA_TRACE'],'a') as f:f.write('gateway:'+os.environ.get('QA_ENDPOINT','missing')+'\\n')
while True:time.sleep(.1)
""")
executable('node',"""#!/usr/bin/env python3
import os,pathlib,sys
name=pathlib.Path(sys.argv[1]).name
if name!='openclaw-agent-db-preflight.mjs':
 p=pathlib.Path(os.environ['QA_PID'])
 if p.exists():
  try:os.kill(int(p.read_text()),0)
  except ProcessLookupError:pass
  else:raise SystemExit('config sync raced a live gateway')
with open(os.environ['QA_TRACE'],'a') as f:f.write('node:'+name+'\\n')
""")
executable('curl','#!/bin/sh\nexit 1\n')
executable('sleep','#!/bin/sh\nexec /bin/sleep 0.05\n')
for name in ['ensure-openclaw-gateway-config.js','configure-openclaw-docker.js','restore-openclaw-channel-routing.js','openclaw-agent-db-preflight.mjs']:(scripts/name).write_text('// isolated fixture\n')
(home/'openclaw.json').write_text('{}')
marker=home/'platform-llm-active.json';runtime=home/'platform-llm-runtime.env';fixed_mtime=1700000000
def switch(endpoint):
    runtime.write_text('QA_ENDPOINT='+endpoint+'\nOPENAI_API_KEY=QA-FAKE-KEY\n');runtime.chmod(0o600)
    marker.write_text(json.dumps({'active':endpoint}));os.utime(marker,(fixed_mtime,fixed_mtime))
def await_trace(line):
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        lines=trace.read_text().splitlines() if trace.exists() else []
        if line in lines:return lines
        if runner.poll() is not None:raise AssertionError('Watcher exited prematurely')
        time.sleep(.05)
    raise AssertionError('Watcher did not reach '+line)
switch('primary')
source=(pathlib.Path(__file__).parent.parent/'docker/openclaw-entrypoint.sh').read_text().split('case "${MODE}" in',1)[0]
test_script=root/'watcher.sh';test_script.write_text(source+'\nrun_gateway_with_platform_llm_watch\n')
environment={**os.environ,'PATH':str(bin_dir)+':'+os.environ['PATH'],'AGENT_OS_ROOT':str(app),'OPENCLAW_DIR':str(home),'OPENCLAW_CONFIG_PATH':str(home/'openclaw.json'),'QA_TRACE':str(trace),'QA_PID':str(pid_file),'ENABLE_VNC':'0'}
output=root/'watcher.log'
with output.open('w') as log:
    runner=subprocess.Popen(['bash',str(test_script)],env=environment,stdout=log,stderr=log,start_new_session=True)
    try:
        await_trace('gateway:primary');switch('secondary');await_trace('gateway:secondary')
        before=trace.read_text().splitlines().count('gateway:primary');switch('primary')
        deadline=time.monotonic()+15
        while time.monotonic()<deadline and trace.read_text().splitlines().count('gateway:primary')==before:time.sleep(.05)
        lines=trace.read_text().splitlines();assert lines.count('gateway:primary')==2
        assert lines.count('node:configure-openclaw-docker.js')==2
        assert lines.count('node:openclaw-agent-db-preflight.mjs')==3
        assert int(marker.stat().st_mtime)==fixed_mtime
        assert 'config sync raced' not in output.read_text()
        assert 'QA-FAKE-KEY' not in output.read_text()
    finally:
        os.killpg(runner.pid,signal.SIGTERM)
        try:runner.wait(timeout=3)
        except subprocess.TimeoutExpired:os.killpg(runner.pid,signal.SIGKILL);runner.wait()
print(json.dumps({'passed':True,'sequence':['primary','secondary','primary'],'same_second_changes_detected':True,'config_sync_offline':True,'auth_preflight_each_start':True,'production_settings_changed':False}))
