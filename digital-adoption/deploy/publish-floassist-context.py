"""Publish the two FloAssist static assets over an exact, reviewed preimage.

Usage: python3 publish-floassist-context.py BUNDLE STATIC_FLOASSIST_DIRECTORY
The bundle contains assets/, preimages.json and this script. It never changes
installations, expiry, website permissions, runtime services or indexed content.
Knowledge and source maps are published through authenticated management.
"""
import hashlib
import json
import os
import pathlib
import shutil
import sys

bundle = pathlib.Path(sys.argv[1]).resolve()
target = pathlib.Path(sys.argv[2]).resolve(strict=True)
names = ("index.html", "app.js")
expected = json.loads((bundle / "preimages.json").read_text())
if set(expected) != set(names) or target.name != "floassist":
    raise ValueError("Expected the FloAssist directory and two reviewed preimages")
digest = lambda content: hashlib.sha256(content).hexdigest()
before = {name: (target / name).read_bytes() for name in names}
after = {name: (bundle / "assets" / name).read_bytes() for name in names}
for name in names:
    if digest(before[name]) != expected[name]:
        raise RuntimeError(f"Concurrent source change: {name}; reconcile before publishing")
backup = bundle / "static-before"
backup.mkdir(exist_ok=False)
for name in names:
    shutil.copy2(target / name, backup / name)

def replace(name, content):
    path = target / name
    candidate = target / (name + ".copilot-candidate")
    try:
        candidate.write_bytes(content)
        shutil.copymode(path, candidate)
        os.replace(candidate, path)
    finally:
        candidate.unlink(missing_ok=True)

try:
    for name in names:
        replace(name, after[name])
    for name in names:
        if (target / name).read_bytes() != after[name]:
            raise RuntimeError(f"Published asset mismatch: {name}")
except Exception:
    for name in names:
        replace(name, before[name])
    raise
result = {"assets": {name: digest(after[name]) for name in names},
          "backup": str(backup), "runtimeRestarted": False,
          "installationOrPolicyChanged": False}
(bundle / "static-publication.json").write_text(json.dumps(result, indent=2))
print(json.dumps(result))
