# Layer extraction dependencies over the matching backend release. Never change
# OpenClaw or install packages in a running production application container.
ARG BACKEND_IMAGE=agent-os-backend:latest
FROM ${BACKEND_IMAGE}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
ENV OMP_THREAD_LIMIT=1
CMD ["node", "scripts/knowledge-worker.mjs"]
