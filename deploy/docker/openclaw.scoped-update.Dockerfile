# Preserve unrelated deployed gateway code. Entry point synchronizes this plugin
# to the shared OpenClaw extension directory before registering tools.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG SOURCE_REVISION=unversioned
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
COPY scripts/lib/content-tools-allow.js /opt/agent-os/scripts/lib/content-tools-allow.js
COPY scripts/lib/openclaw-extension-integrity.js /opt/agent-os/scripts/lib/openclaw-extension-integrity.js
COPY scripts/verify-openclaw-extension-integrity.mjs /opt/agent-os/scripts/verify-openclaw-extension-integrity.mjs
COPY scripts/sync-openclaw-extensions.js /opt/agent-os/scripts/sync-openclaw-extensions.js
COPY openclaw-extensions/agent-os-content-tools /opt/agent-os/openclaw-extensions/agent-os-content-tools
COPY deploy/docker/openclaw-entrypoint.sh /entrypoint.sh
COPY deploy/scripts/configure-openclaw-docker.js /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
COPY deploy/scripts/install-native-model-budget.mjs /opt/agent-os/deploy/scripts/install-native-model-budget.mjs
RUN node /opt/agent-os/deploy/scripts/install-native-model-budget.mjs
RUN chmod +x /entrypoint.sh && node /opt/agent-os/scripts/verify-openclaw-extension-integrity.mjs --source-only
RUN find /opt/agent-os/openclaw-extensions/agent-os-content-tools -type d -exec chmod 755 {} + && find /opt/agent-os/openclaw-extensions/agent-os-content-tools -type f -exec chmod 644 {} +
