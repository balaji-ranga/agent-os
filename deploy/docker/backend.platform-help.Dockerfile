# Documentation-only overlay of the captured running backend. Application code,
# dependencies, environment, mounts and entrypoint are inherited unchanged.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG HELP_REVISION
LABEL org.flolah.platform-help.revision=${HELP_REVISION}
COPY knowledgebase/platform-help /opt/agent-os/knowledgebase/platform-help
COPY docs-site/docs /opt/agent-os/docs-site/docs
COPY backend/src/services/ceo-default-master-data.js /opt/agent-os/backend/src/services/ceo-default-master-data.js
COPY backend/scripts/check-platform-help-corpus.mjs /opt/agent-os/backend/scripts/check-platform-help-corpus.mjs
COPY backend/scripts/verify-copilot-help.mjs /opt/agent-os/backend/scripts/verify-copilot-help.mjs
WORKDIR /opt/agent-os/backend
RUN node scripts/check-platform-help-corpus.mjs
