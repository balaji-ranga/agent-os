# Focused efficiency release over an immutable captured running image.
# Standard fresh builds remain backend.Dockerfile; no dependency changes.
ARG BASE_IMAGE=agent-os-backend:latest
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.efficiency.revision=${RELEASE_REVISION}
WORKDIR /opt/agent-os/backend
COPY backend/src/config/llm.js ./src/config/llm.js
COPY backend/src/services/efficiency-ollama-transport.js ./src/services/efficiency-ollama-transport.js
COPY backend/src/services/efficiency-execution.js ./src/services/efficiency-execution.js
COPY backend/scripts/test-efficiency-controls.mjs backend/scripts/vps-test-efficiency-controls-live.mjs ./scripts/
COPY backend/scripts/test-efficiency-ollama-transport.mjs ./scripts/
