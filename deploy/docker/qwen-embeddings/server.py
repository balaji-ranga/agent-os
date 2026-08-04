"""
OpenAI-compatible /v1/embeddings for local Qwen embedding models.
Used by Agent OS OpenSearch hybrid RAG - no OpenAI cloud calls.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Any

from flask import Flask, jsonify, request

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("qwen-embeddings")

app = Flask(__name__)

MODEL_ID = (
    os.environ.get("EMBEDDING_MODEL_ID")
    or os.environ.get("OPENSEARCH_EMBEDDING_MODEL")
    or "Qwen/Qwen3-Embedding-0.6B"
).strip()
PORT = int(os.environ.get("EMBEDDING_PORT", "8080"))
MAX_BATCH = max(1, min(int(os.environ.get("EMBEDDING_MAX_BATCH", "16")), 64))
MAX_CHARS = max(256, int(os.environ.get("EMBEDDING_MAX_CHARS", "8000")))
NORMALIZE = str(os.environ.get("EMBEDDING_NORMALIZE", "1")).strip().lower() not in (
    "0",
    "false",
    "no",
)

_model = None
_model_lock = threading.Lock()
_load_error = None
_dims = None


def _truncate(text):
    s = str(text or "")
    if len(s) <= MAX_CHARS:
        return s
    return s[:MAX_CHARS]


def get_model():
    global _model, _load_error, _dims
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        try:
            log.info("Loading embedding model %s ...", MODEL_ID)
            from sentence_transformers import SentenceTransformer

            m = SentenceTransformer(MODEL_ID, trust_remote_code=True)
            probe = m.encode(["ok"], normalize_embeddings=NORMALIZE)
            dim = int(probe.shape[-1]) if hasattr(probe, "shape") else len(probe[0])
            _dims = dim
            _model = m
            _load_error = None
            log.info("Model ready %s dims=%s", MODEL_ID, dim)
            return _model
        except Exception as e:
            _load_error = str(e)
            log.exception("Failed to load model %s", MODEL_ID)
            raise


def _preload():
    try:
        get_model()
    except Exception:
        pass


@app.get("/health")
def health():
    ready = _model is not None
    body = {
        "ok": ready and _load_error is None,
        "ready": ready,
        "model": MODEL_ID,
        "dims": _dims,
        "error": _load_error,
    }
    return jsonify(body), (200 if ready else 503)


@app.get("/v1/models")
def list_models():
    return jsonify(
        {
            "object": "list",
            "data": [
                {
                    "id": MODEL_ID,
                    "object": "model",
                    "owned_by": "local",
                }
            ],
        }
    )


@app.post("/v1/embeddings")
@app.post("/embeddings")
def embeddings():
    try:
        model = get_model()
    except Exception as e:
        return jsonify({"error": "model not ready: %s" % e}), 503

    payload = request.get_json(silent=True) or {}
    raw = payload.get("input")
    if raw is None:
        return jsonify({"error": "input required"}), 400
    if isinstance(raw, str):
        texts = [raw]
    elif isinstance(raw, list):
        texts = []
        for x in raw:
            if isinstance(x, dict):
                texts.append(str(x.get("text", x)))
            else:
                texts.append(str(x))
    else:
        return jsonify({"error": "input must be string or array"}), 400

    inputs = [_truncate(t) for t in texts]
    if not inputs:
        return jsonify({"error": "empty input"}), 400

    req_model = str(payload.get("model") or MODEL_ID).strip() or MODEL_ID
    data_out = []
    try:
        for start in range(0, len(inputs), MAX_BATCH):
            batch = inputs[start : start + MAX_BATCH]
            vectors = model.encode(
                batch,
                normalize_embeddings=NORMALIZE,
                show_progress_bar=False,
            )
            for j, row in enumerate(vectors):
                emb = row.tolist() if hasattr(row, "tolist") else list(row)
                data_out.append(
                    {
                        "object": "embedding",
                        "index": start + j,
                        "embedding": emb,
                    }
                )
    except Exception as e:
        log.exception("encode failed")
        return jsonify({"error": "encode failed: %s" % e}), 502

    return jsonify(
        {
            "object": "list",
            "data": data_out,
            "model": req_model,
            "usage": {
                "prompt_tokens": sum(max(1, len(t) // 4) for t in inputs),
                "total_tokens": sum(max(1, len(t) // 4) for t in inputs),
            },
        }
    )


def main():
    threading.Thread(target=_preload, name="embed-preload", daemon=True).start()
    log.info("Serving Qwen embeddings on :%s model=%s", PORT, MODEL_ID)
    app.run(host="0.0.0.0", port=PORT, threaded=True)


if __name__ == "__main__":
    main()
