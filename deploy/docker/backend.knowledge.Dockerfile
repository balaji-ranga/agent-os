# Context must contain the captured deployed source with the reviewed Knowledge
# diff applied. BASE_IMAGE is the immutable running backend, never a stale tag.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.knowledge.revision=${RELEASE_REVISION}
COPY backend/src /opt/agent-os/backend/src
COPY backend/package.json /opt/agent-os/backend/package.json
COPY backend/scripts /opt/agent-os/backend/scripts
RUN npm run test:knowledge-efficiency && npm run test:knowledge && REQUIRE_SYMLINK_TEST=1 npm run test:platform-skill-catalog
