# Preserve the independently deployed checker/provider/efficiency implementation.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
COPY --chown=1000:1000 src/edit-intent.mjs /adoption/src/edit-intent.mjs
COPY --chown=1000:1000 integrations/checker-contract.mjs /adoption/integrations/checker-contract.mjs
USER 1000:1000
