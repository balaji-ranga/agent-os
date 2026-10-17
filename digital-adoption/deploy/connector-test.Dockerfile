# Isolated integration-test image; never deploy this as a production service.
ARG ADOPTION_IMAGE
ARG PLATFORM_IMAGE
FROM ${ADOPTION_IMAGE} AS task-runtime
FROM ${PLATFORM_IMAGE}
COPY --from=task-runtime /adoption /opt/agent-os/digital-adoption
WORKDIR /opt/agent-os/backend
