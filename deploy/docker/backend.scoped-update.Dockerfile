# Emergency scoped rollout from a captured running image. Standard fresh builds
# use backend.Dockerfile; the context must contain copies of the deployed source
# with only reviewed patches applied, not an older whole-repository checkout.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY backend/src /opt/agent-os/backend/src
COPY backend/package.json /opt/agent-os/backend/package.json
COPY backend/scripts/test-* /opt/agent-os/backend/scripts/
COPY backend/scripts/grant-public-news-actions.mjs /opt/agent-os/backend/scripts/
COPY openclaw-workspace-templates /opt/agent-os/openclaw-workspace-templates
COPY scripts/lib/content-tools-allow.js /opt/agent-os/scripts/lib/content-tools-allow.js
COPY openclaw-extensions/agent-os-content-tools /opt/agent-os/openclaw-extensions/agent-os-content-tools
RUN find /opt/agent-os/openclaw-extensions/agent-os-content-tools -type d -exec chmod 755 {} + && find /opt/agent-os/openclaw-extensions/agent-os-content-tools -type f -exec chmod 644 {} +
