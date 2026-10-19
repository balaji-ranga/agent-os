# Scoped coordinator update: preserve parser dependencies and gateway lineage.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
WORKDIR /adoption
COPY --chown=1000:1000 src ./src
COPY --chown=1000:1000 web ./web
COPY --chown=1000:1000 integrations ./integrations
USER 1000:1000
