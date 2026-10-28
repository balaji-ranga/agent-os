"""Bounded, synthetic local-checker comparison; never changes model routing/.env.

The output directory must contain the prior benchmark's fixtures.json. Source
mounts contain code only, and the container receives no production credentials.
Temporary CPU allocation is restored even when the benchmark fails.
"""
import argparse
import json
import os
import pathlib
import subprocess
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source-root', required=True)
parser.add_argument('--output-dir', required=True)
parser.add_argument('--model', required=True)
parser.add_argument('--tag', required=True)
parser.add_argument('--cpus', type=float, default=4)
parser.add_argument('--threads', type=int, default=4)
parser.add_argument('--context', type=int, default=32768)
parser.add_argument('--backend', default='agent-os-backend-1')
parser.add_argument('--ollama', default='agent-os-ollama-1')
options = parser.parse_args()
if not (0 < options.cpus <= (os.cpu_count() or 1)) or not (1 <= options.threads <= options.cpus) or not (512 <= options.context <= 32768):
    parser.error('Resource settings exceed this bounded CPU benchmark')
if not options.tag or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in options.tag):
    parser.error('Use a lowercase filename-safe tag')

def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]

source = pathlib.Path(options.source_root).resolve()
output = pathlib.Path(options.output_dir).resolve()
if not (output / 'fixtures.json').is_file():
    raise SystemExit('The recorded paid-maker fixtures are required; no new maker calls are allowed')
baseline = json.loads((output / 'baseline.json').read_text())
for relative in ['backend/src/config/llm.js', 'backend/scripts/test-checker-model-comparison.mjs']:
    if not (source / relative).is_file():
        raise SystemExit('Missing reviewed source: ' + relative)

backend, ollama = inspect(options.backend), inspect(options.ollama)
shared = set(backend['NetworkSettings']['Networks']) & set(ollama['NetworkSettings']['Networks'])
if len(shared) != 1:
    raise SystemExit('Expected exactly one common private network; inspect before proceeding')
original_quota = ollama['HostConfig']['NanoCpus']
name = 'checker-comparison-' + uuid.uuid4().hex[:12]
args = ['docker', 'run', '--rm', '--name', name, '--network', next(iter(shared)),
        '--workdir', '/opt/agent-os/backend']
settings = {'CHECKER_COMPARISON': '1', 'CHECKER_TEST_RESOLVER': '1', 'CHECKER_WARMUP': '1',
            'CHECKER_LOCAL_MODEL': options.model, 'CHECKER_RESULT_TAG': options.tag,
            'CHECKER_MAX_OUTPUT_TOKENS': '500', 'CHECKER_TIMEOUT_MS': '60000',
            'MODEL_ROUTING_ENABLED': '0', 'OPENAI_BASE_URL': 'https://unused-maker.invalid/v1',
            'OPENAI_PRIMARY_BASE_URL': 'https://unused-maker.invalid/v1',
            'OPENAI_PRIMARY_API_KEY': 'synthetic-unused', 'OPENAI_API_KEY': 'synthetic-unused',
            'OPENAI_PRIMARY_MODEL': baseline['makerModel'],
            'OPENAI_SECONDARY_BASE_URL': 'http://ollama:11434/v1',
            'OPENAI_SECONDARY_API_KEY': 'ollama', 'OPENAI_SECONDARY_MODEL': options.model,
            'OLLAMA_CHECKER_THREADS': str(options.threads),
            'OLLAMA_CHECKER_NUM_CTX': str(options.context)}
for key, value in settings.items():
    args += ['-e', key + '=' + value]
for relative in ['backend/src', 'backend/scripts']:
    args += ['--mount', 'type=bind,src=' + str(source / relative) + ',dst=/opt/agent-os/' + relative + ',readonly']
args += ['--mount', 'type=bind,src=' + str(output) + ',dst=/benchmark', backend['Config']['Image'],
         'node', 'scripts/test-checker-model-comparison.mjs', 'local', '/benchmark']

try:
    subprocess.run(['docker', 'update', '--cpus', str(options.cpus), options.ollama], check=True, stdout=subprocess.DEVNULL)
    with (output / (options.tag + '.log')).open('w') as log:
        result = subprocess.run(args, stdout=log, stderr=subprocess.STDOUT, timeout=600)
    if result.returncode:
        raise RuntimeError('Synthetic checker process failed; inspect the private log')
    report = json.loads((output / (options.tag + '.json')).read_text())
    print(json.dumps({k: v for k, v in report.items() if k not in ['maker', 'results']}), flush=True)
finally:
    # This unique name belongs only to the disposable test, never an app service.
    subprocess.run(['docker', 'rm', '-f', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    current = inspect(options.ollama)
    if current['HostConfig']['NanoCpus'] == round(options.cpus * 1e9):
        subprocess.run(['docker', 'update', '--cpus', str(original_quota / 1e9), options.ollama], check=True, stdout=subprocess.DEVNULL)
    after = inspect(options.backend)
    restored = inspect(options.ollama)['HostConfig']['NanoCpus'] == original_quota
    metadata = {'model': options.model, 'cpusDuringTest': options.cpus,
                'threads': options.threads, 'context': options.context,
                'originalCpus': original_quota / 1e9, 'cpuQuotaRestored': restored,
                'productionImageUnchanged': after['Image'] == backend['Image'],
                'productionEnvironmentUnchanged': after['Config']['Env'] == backend['Config']['Env'],
                'productionRoutingChanged': False, 'productionCredentialsMounted': False}
    (output / (options.tag + '-environment.json')).write_text(json.dumps(metadata, indent=2))
    print('BENCHMARK_CLEANUP ' + json.dumps(metadata), flush=True)
    if not restored:
        raise RuntimeError('CPU quota changed concurrently; inspect the restoration record')
