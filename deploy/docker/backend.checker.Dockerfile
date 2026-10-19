# Configuration API only; retain the captured running backend and parallel fixes.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.checker.revision=${RELEASE_REVISION}
COPY backend/src/services/copilot-local-models.js backend/src/services/copilot-quality-settings.js /opt/agent-os/backend/src/services/
COPY backend/src/generated/copilot-screen-inventory.json /opt/agent-os/backend/src/generated/copilot-screen-inventory.json
