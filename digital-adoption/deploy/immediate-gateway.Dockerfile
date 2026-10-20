# Preserve the independently deployed checker/provider/efficiency implementation.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
# prepare-immediate-phase.py stages only the allowlisted reviewed files.
COPY --chown=1000:1000 .gateway-overlay/ /adoption/
USER 1000:1000
