# Scoped, conflict-checked overlay on the captured running image. Standard clean
# backend.Dockerfile includes these source files and harnesses automatically.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.approval-lifecycle.revision=${RELEASE_REVISION}
COPY backend/src /opt/agent-os/backend/src
COPY backend/scripts /opt/agent-os/backend/scripts
COPY backend/package.json /opt/agent-os/backend/package.json
