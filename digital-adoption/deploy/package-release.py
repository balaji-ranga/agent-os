"""Package tracked copilot source from a Git checkout; never include local state."""
import argparse
import gzip
import io
from pathlib import Path
import re
import subprocess
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('release', help='Unique release label, up to 80 letters/digits/_/-')
parser.add_argument('--output-dir', type=Path, default=None)
args = parser.parse_args()
if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', args.release):
    parser.error('Invalid release label')
root = Path(__file__).resolve().parent.parent
output_dir = (args.output_dir or root / '.local').resolve()
output = output_dir / f'adoption-release-{args.release}.tar.gz'
paths = subprocess.check_output(
    ['git', '-C', str(root), 'ls-files', '-z', '--', 'src', 'web',
     'integrations', 'deploy', 'test', 'package.json', 'package-lock.json',
     'README.md', 'DESIGN.md', '.dockerignore'],
).decode('utf-8').split('\0')
files = []
for name in sorted(filter(None, paths)):
    path = root / name
    if path.is_symlink() or not path.resolve().is_relative_to(root):
        parser.error(f'Release source must not be a symlink or escape the checkout: {name}')
    if any(part.startswith('.env') or part == '.local' or part == 'node_modules'
           for part in path.relative_to(root).parts) or path.suffix in ('.sqlite', '.pem', '.key'):
        parser.error(f'Private state is not release source: {name}')
    data = path.read_bytes()
    if path.suffix in ('.sh', '.service', '.timer'):
        data = data.replace(b'\r\n', b'\n')
    files.append((name, data))
if not files or not any(name == '.dockerignore' for name, _ in files):
    parser.error('Stage the complete release sources, including .dockerignore, first')
output_dir.mkdir(parents=True, exist_ok=True)
# Exclusive creation preserves an earlier release with the same label.
with output.open('xb') as destination:
    with gzip.GzipFile(fileobj=destination, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w') as archive:
            for name, data in files:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                info.mode = 0o644
                archive.addfile(info, io.BytesIO(data))
print(f'Packaged {len(files)} tracked source files: {output}')
