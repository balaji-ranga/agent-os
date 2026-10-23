#!/usr/bin/env python3
"""Source-only, scoped recovery overlays. No environment/config secrets in bundles.

Local: package --output <new archive.tgz>
VPS: extract into a fresh protected release directory; prepare, then activate.
Activation intentionally never restores a whole old configuration automatically.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time

ROOT = Path(__file__).resolve().parents[2]
SOURCE_FILES = [
    'scripts/apply-session-visibility-and-souls.js', 'scripts/enable-openclaw-browser.js',
    'scripts/ensure-tools-api-key.js', 'scripts/ensure-browser-all-agents.js',
    'scripts/fix-openclaw-ollama-models.js', 'scripts/fix-session-visibility-and-restart-gateway.js',
    'scripts/onboard-api-tool.js', 'scripts/lib/openclaw-channel-routing.js',
    'scripts/setup-job-applicant-agents.js', 'scripts/sync-openclaw-extensions.js',
    'scripts/lib/openclaw-config-contract.js', 'scripts/apply-openclaw-agents-config.js',
    'backend/src/services/openclaw-config-safe.js', 'backend/src/services/openclaw-tenant.js',
    'backend/scripts/vps-test-copilot-platform-map.mjs', 'backend/scripts/test-openclaw-config-contract.mjs',
    'deploy/scripts/configure-openclaw-docker.js', 'deploy/scripts/ensure-openclaw-gateway-config.js',
    'deploy/scripts/validate-openclaw-config.mjs', 'deploy/scripts/validate-openclaw-seeds.mjs',
    'deploy/scripts/test-openclaw-installed-schema.mjs', 'deploy/scripts/gateway-config-recovery.py',
    'deploy/docker/gateway-config-recovery.Dockerfile', 'deploy/docker/backend-config-recovery.Dockerfile',
    'deploy/docker/openclaw-entrypoint.sh', 'deploy/docker/openclaw.Dockerfile', 'deploy/docker/backend.Dockerfile',
    'deploy/scripts/vps-deploy-latest.sh', 'deploy/scripts/vps-bringup.sh',
    'deploy/scripts/vps-verify-openclaw-chat.sh', 'deploy/scripts/verify-openclaw-parity.js',
    'deploy/scripts/sync-to-vps.ps1', 'scripts/setup-openclaw-from-scratch.ps1',
    'scripts/setup-openclaw-from-scratch.sh', 'openclaw-config.example.json',
    'openclaw-config.example-multi-agent.json', 'openclaw-config-gateway-agents.json', 'deploy/README.md',
]
LIVE_BASELINE = {
    'backend': ['backend/src/services/openclaw-config-safe.js', 'backend/src/services/openclaw-tenant.js', 'scripts/lib/openclaw-channel-routing.js'],
    'openclaw': ['scripts/apply-openclaw-agents-config.js', 'deploy/scripts/configure-openclaw-docker.js',
                 'deploy/scripts/ensure-openclaw-gateway-config.js', 'deploy/docker/openclaw-entrypoint.sh'],
}

def run(args, **kwargs):
    return subprocess.check_output(args, **kwargs)

def digest(data):
    return hashlib.sha256(data.replace(b'\r\n', b'\n')).hexdigest()

def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]

def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n', encoding='utf8')
    path.chmod(0o600)

def package(output):
    manifest = {'sourceCommit': run(['git', 'rev-parse', 'HEAD'], cwd=ROOT).decode().strip(),
                'files': {}, 'baseline': {}}
    for paths in LIVE_BASELINE.values():
        for path in paths:
            manifest['baseline'][path] = digest(run(['git', 'show', 'HEAD:' + path], cwd=ROOT))
    with tarfile.open(output, 'x:gz') as archive:
        for path in SOURCE_FILES:
            data = (ROOT / path).read_bytes().replace(b'\r\n', b'\n')
            manifest['files'][path] = digest(data)
            info = tarfile.TarInfo(path); info.size = len(data); info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))
        data = json.dumps(manifest, indent=2).encode()
        info = tarfile.TarInfo('recovery-manifest.json'); info.size = len(data); info.mode = 0o600
        archive.addfile(info, io.BytesIO(data))
    print(json.dumps({'packaged': len(SOURCE_FILES), 'archive': str(output), 'sourceCommit': manifest['sourceCommit']}))

def prepare(release):
    manifest = json.loads((ROOT / 'recovery-manifest.json').read_text())
    for path, expected in manifest['files'].items():
        if path not in SOURCE_FILES or digest((ROOT / path).read_bytes()) != expected:
            raise RuntimeError('Bundle integrity mismatch: ' + path)
    state = {'release': release, 'services': {}, 'otherContainers': {}}
    for cid in run(['docker', 'ps', '-q']).decode().split():
        item = inspect(cid)
        if item['Name'] not in ['/agent-os-backend-1', '/agent-os-openclaw-1']:
            state['otherContainers'][item['Name']] = item['Id']
    for service, paths in LIVE_BASELINE.items():
        container = 'agent-os-' + service + '-1'; item = inspect(container)
        for path in paths:
            runtime_path = '/entrypoint.sh' if path.endswith('openclaw-entrypoint.sh') else '/opt/agent-os/' + path
            actual = digest(run(['docker', 'exec', container, 'cat', runtime_path]))
            if actual != manifest['baseline'][path]:
                raise RuntimeError('Running source differs from reviewed baseline; reconcile before overlay: ' + path)
        labels = item['Config']['Labels']
        tag = 'agent-os-' + service + ':' + release
        state['services'][service] = {'container': container, 'previousImage': item['Image'],
            'previousTag': item['Config']['Image'], 'image': tag,
            'project': labels['com.docker.compose.project'],
            'files': labels['com.docker.compose.project.config_files'].split(','),
            'directory': labels['com.docker.compose.project.working_dir']}
        dockerfile = 'backend-config-recovery' if service == 'backend' else 'gateway-config-recovery'
        # BuildKit treats a bare sha256 ID as a registry name; give the exact
        # inspected local image a release-specific reference without pulling.
        base_tag = 'agent-os-' + service + ':recovery-base-' + release
        subprocess.run(['docker', 'tag', item['Image'], base_tag], check=True)
        with (ROOT / (service + '-build.log')).open('wb') as log:
            subprocess.run(['docker', 'build', '--build-arg', 'BASE_IMAGE=' + base_tag, '-f',
                str(ROOT / ('deploy/docker/' + dockerfile + '.Dockerfile')), '-t', tag, str(ROOT)],
                stdout=log, stderr=subprocess.STDOUT, check=True)
        print(json.dumps({'built': service, 'image': tag}), flush=True)
    backend = state['services']['backend']['image']; gateway = state['services']['openclaw']['image']
    for test in ['test-openclaw-config-contract.mjs', 'test-openclaw-config-noop.mjs', 'test-openclaw-agent-activation.mjs']:
        result = run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', 'node', backend,
            '/opt/agent-os/backend/scripts/' + test]).decode()
        (ROOT / (test + '.log')).write_text(result)
        print(json.dumps({'regression': test, 'passed': True}), flush=True)
    for shell in ['deploy/docker/openclaw-entrypoint.sh', 'scripts/setup-openclaw-from-scratch.sh',
                  'deploy/scripts/vps-deploy-latest.sh', 'deploy/scripts/vps-bringup.sh', 'deploy/scripts/vps-verify-openclaw-chat.sh']:
        subprocess.run(['bash', '-n', str(ROOT / shell)], check=True)
    gate = run(['docker', 'run', '--rm', '--network', 'none', '--volumes-from', 'agent-os-openclaw-1:ro',
                '--entrypoint', 'node', gateway, '/opt/agent-os/deploy/scripts/validate-openclaw-config.mjs']).decode()
    (ROOT / 'preactivation-schema.log').write_text(gate)
    negative = run(['docker', 'run', '--rm', '--network', 'none', '--volumes-from', 'agent-os-openclaw-1:ro',
                '--entrypoint', 'node', gateway, '/opt/agent-os/deploy/scripts/test-openclaw-installed-schema.mjs']).decode()
    (ROOT / 'installed-schema-regression.json').write_text(negative)
    save(ROOT / 'recovery-state.json', state)
    print(json.dumps({'prepared': release, 'schemaValidated': True, 'negativeTestsPassed': True}))

def activate():
    state = json.loads((ROOT / 'recovery-state.json').read_text())
    # Detect intervening releases. Never replace a newer image accidentally.
    for service, data in state['services'].items():
        if inspect(data['container'])['Image'] != data['previousImage']:
            raise RuntimeError('Service image changed since preparation: ' + service)
    gateway = state['services']['openclaw']['image']
    subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--volumes-from', 'agent-os-openclaw-1:ro',
        '--entrypoint', 'node', gateway, '/opt/agent-os/deploy/scripts/validate-openclaw-config.mjs'], check=True)
    config_backup = "const fs=require('fs');const p='/root/.openclaw/incident-backups/" + state['release'] + "';fs.mkdirSync(p,{recursive:true,mode:448});fs.copyFileSync('/root/.openclaw/openclaw.json',p+'/openclaw.json');fs.chmodSync(p+'/openclaw.json',384);"
    subprocess.run(['docker', 'exec', 'agent-os-openclaw-1', 'node', '-e', config_backup], check=True)
    # Preserve previous host scripts, then sync only the reviewed source allowlist.
    backup = ROOT / 'previous-host-source'
    for path in SOURCE_FILES:
        destination = Path('/opt/agent-os') / path
        if destination.exists():
            target = backup / path; target.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(destination, target)
        destination.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(ROOT / path, destination)
    for service in ['backend', 'openclaw']:
        data = state['services'][service]
        override = ROOT / (service + '.override.json')
        save(override, {'services': {service: {'image': data['image']}}})
        command = ['docker', 'compose', '-p', data['project']]
        for path in data['files'] + [str(override)]:
            command += ['-f', path]
        subprocess.run(command + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', '--force-recreate', service],
            cwd=data['directory'], check=True)
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline:
            current = inspect(data['container']); status = current['State']
            if status.get('Health', {}).get('Status') == 'healthy' and status['Running']:
                break
            if current['RestartCount'] > 0 or status['Status'] == 'exited':
                raise RuntimeError('Service failed readiness; preserve evidence, use recorded previous image for scoped rollback: ' + service)
            time.sleep(5)
        else:
            raise RuntimeError('Service readiness timed out: ' + service)
        print(json.dumps({'activated': service, 'healthy': True, 'restarts': current['RestartCount']}), flush=True)
    for name, cid in state['otherContainers'].items():
        if inspect(name)['Id'] != cid:
            raise RuntimeError('Unrelated container changed: ' + name)
    save(ROOT / 'activation-result.json', {'release': state['release'], 'healthy': True, 'unrelatedContainersUnchanged': True})
    print(json.dumps({'activated': state['release'], 'unrelatedContainersUnchanged': True}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__); sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('package'); p.add_argument('--output', type=Path, required=True)
    p = sub.add_parser('prepare'); p.add_argument('--release', required=True)
    sub.add_parser('activate'); args = parser.parse_args()
    if args.command == 'package':
        package(args.output)
    else:
        if os.name != 'posix' or os.geteuid() != 0:
            raise SystemExit('VPS preparation/activation requires Linux root')
        if args.command == 'prepare':
            if not args.release.replace('-', '').isalnum() or len(args.release) > 64:
                raise SystemExit('Use a short alphanumeric/hyphen release name')
            prepare(args.release)
        else:
            activate()
