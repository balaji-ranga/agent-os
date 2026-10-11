# Reuse the verified deployed dependency image; update only the server source.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.embeddings.revision=${RELEASE_REVISION}
COPY deploy/docker/qwen-embeddings/server.py /app/server.py
RUN python -m py_compile /app/server.py
