# Preserve the independently deployed checker/provider/efficiency implementation.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=1000:1000 src/edit-intent.mjs /adoption/src/edit-intent.mjs
COPY --chown=1000:1000 integrations/checker-contract.mjs /adoption/integrations/checker-contract.mjs
COPY --chown=1000:1000 src/proposals.mjs /adoption/src/proposals.mjs
COPY --chown=1000:1000 src/action-attempts.mjs /adoption/src/action-attempts.mjs
COPY --chown=1000:1000 src/assistant-contract.mjs /adoption/src/assistant-contract.mjs
COPY --chown=1000:1000 integrations/maker-checker.mjs /adoption/integrations/maker-checker.mjs
COPY --chown=1000:1000 src/goal-contract.mjs /adoption/src/goal-contract.mjs
COPY --chown=1000:1000 integrations/platform-gateway.mjs /adoption/integrations/platform-gateway.mjs
COPY --chown=1000:1000 web/choice-intent.mjs /adoption/web/choice-intent.mjs
COPY --chown=1000:1000 src/task-intent.mjs /adoption/src/task-intent.mjs
USER 1000:1000

COPY --chown=1000:1000 web/guidance-intent.mjs /adoption/web/guidance-intent.mjs
