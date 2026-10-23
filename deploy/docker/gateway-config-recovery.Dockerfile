# Scoped overlay: preserve the running gateway/runtime and unrelated fixes.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY scripts/ /opt/agent-os/scripts/
COPY deploy/scripts/configure-openclaw-docker.js /opt/agent-os/deploy/scripts/configure-openclaw-docker.js
COPY deploy/scripts/ensure-openclaw-gateway-config.js /opt/agent-os/deploy/scripts/ensure-openclaw-gateway-config.js
COPY deploy/scripts/validate-openclaw-config.mjs /opt/agent-os/deploy/scripts/validate-openclaw-config.mjs
COPY deploy/scripts/validate-openclaw-seeds.mjs /opt/agent-os/deploy/scripts/validate-openclaw-seeds.mjs
COPY deploy/scripts/test-openclaw-installed-schema.mjs /opt/agent-os/deploy/scripts/test-openclaw-installed-schema.mjs
COPY openclaw-config*.json /opt/agent-os/
COPY deploy/docker/openclaw-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && node /opt/agent-os/deploy/scripts/validate-openclaw-seeds.mjs
