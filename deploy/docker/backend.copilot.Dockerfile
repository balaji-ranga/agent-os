ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.copilot.revision=${RELEASE_REVISION}
COPY backend/src /opt/agent-os/backend/src
COPY backend/package.json /opt/agent-os/backend/package.json
COPY backend/scripts /opt/agent-os/backend/scripts
COPY openclaw-workspace-templates/platformhelp /opt/agent-os/openclaw-workspace-templates/platformhelp
COPY knowledgebase/platform-help /opt/agent-os/knowledgebase/platform-help
COPY docs-site/docs /opt/agent-os/docs-site/docs
WORKDIR /opt/agent-os/backend
RUN npm run test:ui-copilot
