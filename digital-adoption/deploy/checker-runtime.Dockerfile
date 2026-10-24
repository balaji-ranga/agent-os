# Scoped, reproducible overlay of the captured current coordinator image. This
# preserves concurrent runtime/retention changes and all existing dependencies.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG RELEASE_REVISION
LABEL org.flolah.checker.revision=${RELEASE_REVISION}
COPY digital-adoption/integrations/checker-contract.mjs digital-adoption/integrations/gateway-settings.mjs digital-adoption/integrations/maker-checker.mjs digital-adoption/integrations/model-gateway-server.mjs digital-adoption/integrations/provider-completion.mjs /adoption/integrations/
COPY digital-adoption/src/page-understanding.mjs digital-adoption/src/page-context-contract.mjs digital-adoption/src/arithmetic-evidence.mjs /adoption/src/
