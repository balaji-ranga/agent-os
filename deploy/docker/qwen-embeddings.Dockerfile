# Local Qwen embedding server (OpenAI-compatible /v1/embeddings) for Agent OS RAG.
# CPU default; no OpenAI cloud. Model cached under /data/embeddings (volume).
FROM python:3.11-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU torch first (smaller than CUDA), then sentence-transformers stack
RUN pip install --no-cache-dir \
      --index-url https://download.pytorch.org/whl/cpu \
      torch \
  && pip install --no-cache-dir \
      "sentence-transformers>=3.0.0" \
      "transformers>=4.51.0" \
      flask \
      accelerate

COPY deploy/docker/qwen-embeddings/server.py /app/server.py

ENV EMBEDDING_MODEL_ID=Qwen/Qwen3-Embedding-0.6B \
    EMBEDDING_PORT=8080 \
    HF_HOME=/data/embeddings \
    TRANSFORMERS_CACHE=/data/embeddings/transformers \
    SENTENCE_TRANSFORMERS_HOME=/data/embeddings/sentence-transformers \
    HF_HUB_DISABLE_PROGRESS_BARS=1 \
    TOKENIZERS_PARALLELISM=false

RUN mkdir -p /data/embeddings

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=10s --start-period=600s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["python", "/app/server.py"]
