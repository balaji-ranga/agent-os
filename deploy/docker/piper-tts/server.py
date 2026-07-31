"""Minimal Piper TTS HTTP for Agent OS optional-voice profile."""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path

from flask import Flask, Response, request

app = Flask(__name__)

VOICE = os.environ.get("PIPER_VOICE", "en_US-lessac-medium").strip()
DATA_DIR = Path(os.environ.get("PIPER_DATA_DIR", "/data/piper"))
PORT = int(os.environ.get("PIPER_PORT", "5500"))


def voice_model_path(voice: str) -> Path:
    name = (voice or VOICE).strip() or VOICE
    candidate = DATA_DIR / f"{name}.onnx"
    if candidate.exists():
        return candidate
    fallback = DATA_DIR / f"{VOICE}.onnx"
    if fallback.exists():
        return fallback
    raise FileNotFoundError(f"Piper voice model not found: {name}")


@app.get("/health")
def health():
    return {"ok": True, "voice": VOICE}


@app.post("/")
@app.post("/tts")
def tts():
    payload = request.get_json(silent=True) or {}
    text = str(payload.get("text") or "").strip()
    if not text:
        return {"error": "text required"}, 400
    voice = str(payload.get("voice") or payload.get("voiceId") or VOICE).strip()
    length_scale = payload.get("length_scale", payload.get("lengthScale", 1.0))
    try:
        model = voice_model_path(voice)
    except FileNotFoundError as e:
        return {"error": str(e)}, 404

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        out_path = tmp.name
    try:
        cmd = [
            "piper",
            "--model",
            str(model),
            "--output_file",
            out_path,
        ]
        try:
            scale = float(length_scale)
            if scale > 0:
                cmd.extend(["--length_scale", str(scale)])
        except (TypeError, ValueError):
            pass
        proc = subprocess.run(
            cmd,
            input=text.encode("utf-8"),
            capture_output=True,
            timeout=120,
            check=False,
        )
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or b"").decode("utf-8", errors="replace")[:400]
            return {"error": f"piper failed: {err}"}, 502
        data = Path(out_path).read_bytes()
        return Response(data, mimetype="audio/wav")
    finally:
        try:
            Path(out_path).unlink(missing_ok=True)
        except OSError:
            pass


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, threaded=True)
