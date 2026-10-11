ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.kanban-observer.revision=${RELEASE_REVISION}
COPY backend/src /opt/agent-os/backend/src
COPY backend/scripts /opt/agent-os/backend/scripts
COPY backend/package.json /opt/agent-os/backend/package.json
