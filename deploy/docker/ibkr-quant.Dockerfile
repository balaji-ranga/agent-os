FROM python:3.11-slim-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY deploy/docker/ibkr-quant/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY deploy/docker/ibkr-quant/server.py ./server.py

ENV QUANT_PORT=8090 \
    QUANT_MODELS_DIR=/models \
    QUANT_DEFAULT_BACKEND=baseline \
    GRANITE_TTM_MODEL_ID=ibm-granite/granite-timeseries-ttm-r2 \
    HF_HOME=/models/huggingface \
    TRANSFORMERS_CACHE=/models/huggingface

RUN mkdir -p /models
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8090/health || exit 1
CMD ["python", "/app/server.py"]
