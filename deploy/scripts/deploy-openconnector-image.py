#!/usr/bin/env python3
"""Replace only OpenConnector's image, preserving its live environment.

Run on the VPS: python3 deploy-openconnector-image.py IMAGE RELEASE_DIRECTORY
The release directory holds a root-only environment snapshot. Never commit it.
"""
import json
import os
from pathlib import Path
import subprocess
import sys


def checked_environment(container):
    env = dict(value.split('=', 1) for value in container['Config']['Env'])
    if not env.get('OOMOL_CONNECT_ENCRYPTION_KEY', '').strip():
        raise RuntimeError('OpenConnector encryption key missing: refuse recreation; restore existing key first')
    return env


def deploy(image, release):
    os.umask(0o077)
    name = 'agent-os-openconnector-1'
    inspect = lambda: json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
    before = inspect()
    environment = checked_environment(before)
    release = Path(release).resolve()
    release.mkdir(parents=True, exist_ok=True)
    snapshot = release / 'openconnector-before.private.json'
    snapshot.write_text(json.dumps(before))
    snapshot.chmod(0o600)
    overlay = release / 'compose-openconnector.private.json'
    # Explicit environment wins over stale/missing .env interpolation. Values stay on VPS.
    overlay.write_text(json.dumps({'services': {'openconnector': {'image': image, 'environment': environment}}}))
    overlay.chmod(0o600)
    labels = before['Config']['Labels']
    command = ['docker', 'compose', '--profile', 'optional-openconnector', '--project-name', labels['com.docker.compose.project']]
    for path in dict.fromkeys(labels['com.docker.compose.project.config_files'].split(',') + [str(overlay)]):
        command.extend(['-f', path])
    cwd = labels['com.docker.compose.project.working_dir']
    resolved = json.loads(subprocess.check_output(command + ['config', '--format', 'json'], cwd=cwd))
    actual = resolved['services']['openconnector']['environment']
    if any(actual.get(key) != value for key, value in environment.items()):
        raise RuntimeError('Resolved environment differs from running connector; deployment refused')
    if inspect()['Id'] != before['Id']:
        raise RuntimeError('Concurrent connector deployment; refusing stale snapshot')
    subprocess.run(command + ['up', '-d', '--no-deps', '--no-build', 'openconnector'], cwd=cwd, check=True)
    if checked_environment(inspect()) != environment:
        raise RuntimeError('Post-deployment environment mismatch')
    print('OpenConnector image deployed; original environment preserved')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: deploy-openconnector-image.py IMAGE RELEASE_DIRECTORY')
    deploy(*sys.argv[1:])
