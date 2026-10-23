ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY scripts/lib/openclaw-config-contract.js /opt/agent-os/scripts/lib/openclaw-config-contract.js
COPY scripts/lib/openclaw-channel-routing.js /opt/agent-os/scripts/lib/openclaw-channel-routing.js
COPY backend/src/services/openclaw-config-safe.js /opt/agent-os/backend/src/services/openclaw-config-safe.js
COPY backend/src/services/openclaw-tenant.js /opt/agent-os/backend/src/services/openclaw-tenant.js
COPY backend/scripts/vps-test-copilot-platform-map.mjs /opt/agent-os/backend/scripts/vps-test-copilot-platform-map.mjs
COPY backend/scripts/test-openclaw-config-contract.mjs /opt/agent-os/backend/scripts/test-openclaw-config-contract.mjs
