# Piper TTS HTTP for Agent OS optional-voice profile
FROM python:3.11-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && pip install --no-cache-dir flask piper-tts

WORKDIR /app
COPY deploy/docker/piper-tts/server.py /app/server.py

ENV PIPER_VOICE=en_US-lessac-medium \
    PIPER_PORT=5500 \
    PIPER_DATA_DIR=/data/piper

RUN mkdir -p /data/piper \
  && python - <<'PY'
from pathlib import Path
import urllib.request
base = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium"
dest = Path("/data/piper")
dest.mkdir(parents=True, exist_ok=True)
for suffix in (".onnx", ".onnx.json"):
    url = f"{base}/en_US-lessac-medium{suffix}"
    out = dest / f"en_US-lessac-medium{suffix}"
    if not out.exists():
        print("Downloading", url)
        urllib.request.urlretrieve(url, out)
print("Voice ready")
PY

EXPOSE 5500
CMD ["python", "/app/server.py"]