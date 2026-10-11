# Narrow Home release over a captured immutable production image.
# Fresh builds continue to include these files through backend.Dockerfile.
ARG BASE_IMAGE=agent-os-backend:latest
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.home-team-activity.revision=${RELEASE_REVISION}
WORKDIR /opt/agent-os/backend
COPY backend/package.json ./package.json
COPY backend/src/routes/home.js ./src/routes/home.js
COPY backend/src/services/home-team-activity.js ./src/services/home-team-activity.js
COPY backend/scripts/test-home-team-activity.mjs backend/scripts/vps-test-home-team-activity-live.mjs ./scripts/
