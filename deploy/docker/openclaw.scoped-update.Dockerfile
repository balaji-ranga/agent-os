# Preserve unrelated deployed gateway code. Entry point synchronizes this plugin
# to the shared OpenClaw extension directory before registering tools.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY scripts/lib/content-tools-allow.js /opt/agent-os/scripts/lib/content-tools-allow.js
COPY openclaw-extensions/agent-os-content-tools /opt/agent-os/openclaw-extensions/agent-os-content-tools
