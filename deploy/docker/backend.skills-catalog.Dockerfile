# Focused release: preserve the captured running backend and unrelated components.
# Build context must contain only the reviewed feature overlay. BASE_IMAGE must
# be an immutable, locally captured image ID/tag, not an unverified latest tag.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.skills-catalog.revision=${RELEASE_REVISION}
WORKDIR /opt/agent-os/backend
COPY backend/package.json ./package.json
COPY backend/src/index.js ./src/index.js
COPY backend/src/routes/admin-skills.js ./src/routes/admin-skills.js
COPY backend/src/services/agent-skills.js backend/src/services/agent-command-runtime.js backend/src/services/skill-package.js backend/src/services/platform-skill-catalog.js ./src/services/
COPY backend/scripts/test-platform-skill-catalog.mjs ./scripts/test-platform-skill-catalog.mjs
COPY skills-catalog /opt/agent-os/skills-catalog
# Do not add mounts, change credentials, install plugins, or restart bridges.
