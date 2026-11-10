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
COPY deploy/scripts/install-native-compaction-ask-match.mjs /opt/agent-os/deploy/scripts/install-native-compaction-ask-match.mjs
COPY backend/scripts/test-native-compaction-ask-match.mjs /opt/agent-os/backend/scripts/test-native-compaction-ask-match.mjs
RUN node /opt/agent-os/deploy/scripts/install-native-compaction-ask-match.mjs && node /opt/agent-os/backend/scripts/test-native-compaction-ask-match.mjs
COPY deploy/scripts/install-native-tool-name-alias.mjs /opt/agent-os/deploy/scripts/install-native-tool-name-alias.mjs
COPY backend/scripts/test-native-tool-name-alias.mjs /opt/agent-os/backend/scripts/test-native-tool-name-alias.mjs
RUN node /opt/agent-os/deploy/scripts/install-native-tool-name-alias.mjs && node /opt/agent-os/backend/scripts/test-native-tool-name-alias.mjs
COPY deploy/scripts/install-native-heartbeat-silence.mjs /opt/agent-os/deploy/scripts/install-native-heartbeat-silence.mjs
RUN node /opt/agent-os/deploy/scripts/install-native-heartbeat-silence.mjs
COPY deploy/scripts/install-native-sqlite-reopen.mjs deploy/scripts/install-native-memory-delta.mjs deploy/scripts/install-native-sqlite-diagnostics.mjs deploy/scripts/install-native-prompt-context.mjs /opt/agent-os/deploy/scripts/
RUN node /opt/agent-os/deploy/scripts/install-native-sqlite-reopen.mjs && node /opt/agent-os/deploy/scripts/install-native-memory-delta.mjs && node /opt/agent-os/deploy/scripts/install-native-sqlite-diagnostics.mjs && node /opt/agent-os/deploy/scripts/install-native-prompt-context.mjs
COPY backend/scripts/test-heartbeat-silence*.mjs /opt/agent-os/backend/scripts/
COPY deploy/scripts/install-native-harness-roster-snapshot.mjs /opt/agent-os/deploy/scripts/
COPY backend/scripts/test-native-harness-roster-snapshot.mjs /opt/agent-os/backend/scripts/
RUN node /opt/agent-os/deploy/scripts/install-native-harness-roster-snapshot.mjs && node /opt/agent-os/backend/scripts/test-native-harness-roster-snapshot.mjs
COPY backend/scripts/test-connector-dynamic-input.mjs /opt/agent-os/backend/scripts/
RUN node /opt/agent-os/backend/scripts/test-connector-dynamic-input.mjs
COPY backend/scripts/test-native-reopen-schema-stamp.mjs backend/scripts/test-native-sqlite-reopen.mjs backend/scripts/test-native-recovery-context-window.mjs /opt/agent-os/backend/scripts/
COPY deploy/scripts/install-native-recovery-context-window.mjs /opt/agent-os/deploy/scripts/
RUN node /opt/agent-os/backend/scripts/test-native-reopen-schema-stamp.mjs && node /opt/agent-os/backend/scripts/test-native-sqlite-reopen.mjs
RUN node /opt/agent-os/deploy/scripts/install-native-recovery-context-window.mjs && node /opt/agent-os/backend/scripts/test-native-recovery-context-window.mjs
RUN chmod +x /entrypoint.sh && node /opt/agent-os/scripts/verify-openclaw-extension-integrity.mjs --source-only
RUN find /opt/agent-os/openclaw-extensions/agent-os-content-tools -type d -exec chmod 755 {} + && find /opt/agent-os/openclaw-extensions/agent-os-content-tools -type f -exec chmod 644 {} +
